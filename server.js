const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("inventory.db");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  product_code TEXT UNIQUE NOT NULL,
  pieces_per_box INTEGER NOT NULL DEFAULT 1,
  mrp REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  action TEXT NOT NULL,
  old_data TEXT,
  new_data TEXT,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const setting = (key, fallback) => {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : fallback;
};
const setSetting = (key, value) => db.prepare(
  "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
).run(key, String(value));

if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
  db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)")
    .run("Goyal sales", bcrypt.hashSync("goyal@7250", 12), "admin");
}
if (!setting("company_name", "")) setSetting("company_name", "Goyal Sales Inventory");
if (!setting("footer", "")) setSetting("footer", "Goyal Sales Inventory — Designed & Developed by Debu");

const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static(path.join(__dirname, "public")));

function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:"Login required"}); next(); }
function admin(req,res,next){ if(!req.session.user || req.session.user.role!=="admin") return res.status(403).json({error:"Admin permission required"}); next(); }

function cleanProduct(p){
  return {
    product_name: String(p.product_name||"").trim(),
    brand_name: String(p.brand_name||"").trim(),
    product_code: String(p.product_code||"").trim(),
    pieces_per_box: Math.max(1, parseInt(p.pieces_per_box||1,10)),
    mrp: Math.max(0, Number(p.mrp||0)),
    rate: Math.max(0, Number(p.rate||0))
  };
}
function logHistory(productId, action, oldData, newData, user){
  db.prepare(`INSERT INTO history(product_id,action,old_data,new_data,changed_by) VALUES(?,?,?,?,?)`)
    .run(productId, action, oldData ? JSON.stringify(oldData):null, newData ? JSON.stringify(newData):null, user);
}

app.post("/api/login",(req,res)=>{
  const {username,password}=req.body||{};
  const u=db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
  if(!u || !bcrypt.compareSync(password||"",u.password_hash)) return res.status(401).json({error:"Invalid login ID or password"});
  req.session.user={id:u.id,username:u.username,role:u.role};
  res.json({user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.get("/api/settings",(req,res)=>res.json({
  company_name:setting("company_name","Goyal Sales Inventory"),
  footer:setting("footer","Goyal Sales Inventory — Designed & Developed by Debu"),
  logo:setting("logo","")
}));

app.get("/api/products",auth,(req,res)=>{
  const q=String(req.query.q||"").trim();
  if(q){
    const like=`%${q}%`;
    return res.json(db.prepare(`SELECT * FROM products
      WHERE product_name LIKE ? OR brand_name LIKE ? OR product_code LIKE ?
      ORDER BY id DESC`).all(like,like,like));
  }
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/products",admin,(req,res)=>{
  try{
    const p=cleanProduct(req.body);
    if(!p.product_name||!p.brand_name||!p.product_code) return res.status(400).json({error:"Product name, brand name and product code are required"});
    const info=db.prepare(`INSERT INTO products(product_name,brand_name,product_code,pieces_per_box,mrp,rate)
      VALUES(@product_name,@brand_name,@product_code,@pieces_per_box,@mrp,@rate)`).run(p);
    const row=db.prepare("SELECT * FROM products WHERE id=?").get(info.lastInsertRowid);
    logHistory(row.id,"CREATE",null,row,req.session.user.username);
    res.json(row);
  }catch(e){ res.status(400).json({error:e.message.includes("UNIQUE")?"Product code already exists":e.message}); }
});

app.put("/api/products/:id",admin,(req,res)=>{
  try{
    const id=Number(req.params.id);
    const old=db.prepare("SELECT * FROM products WHERE id=?").get(id);
    if(!old) return res.status(404).json({error:"Product not found"});
    const p=cleanProduct(req.body);
    db.prepare(`UPDATE products SET product_name=@product_name,brand_name=@brand_name,product_code=@product_code,
      pieces_per_box=@pieces_per_box,mrp=@mrp,rate=@rate,updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({...p,id});
    const row=db.prepare("SELECT * FROM products WHERE id=?").get(id);
    logHistory(id,"UPDATE",old,row,req.session.user.username);
    res.json(row);
  }catch(e){ res.status(400).json({error:e.message.includes("UNIQUE")?"Product code already exists":e.message}); }
});

app.delete("/api/products/:id",admin,(req,res)=>{
  const id=Number(req.params.id);
  const old=db.prepare("SELECT * FROM products WHERE id=?").get(id);
  if(!old) return res.status(404).json({error:"Product not found"});
  db.prepare("DELETE FROM products WHERE id=?").run(id);
  logHistory(id,"DELETE",old,null,req.session.user.username);
  res.json({ok:true});
});

app.get("/api/history",admin,(req,res)=>{
  res.json(db.prepare(`SELECT h.*,p.product_name,p.product_code FROM history h
    LEFT JOIN products p ON p.id=h.product_id ORDER BY h.id DESC`).all());
});

app.get("/api/users",admin,(req,res)=>{
  res.json(db.prepare("SELECT id,username,role,active,created_at FROM users ORDER BY id").all());
});
app.post("/api/users",admin,(req,res)=>{
  try{
    const username=String(req.body.username||"").trim();
    const password=String(req.body.password||"");
    const role=req.body.role==="admin"?"admin":"viewer";
    if(!username||password.length<4) return res.status(400).json({error:"Username and password are required (password min 4 characters)"});
    const info=db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)")
      .run(username,bcrypt.hashSync(password,12),role);
    res.json({id:info.lastInsertRowid,username,role,active:1});
  }catch(e){res.status(400).json({error:"Username already exists"});}
});
app.put("/api/users/:id",admin,(req,res)=>{
  const id=Number(req.params.id);
  const target=db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if(!target) return res.status(404).json({error:"User not found"});
  const role=req.body.role==="admin"?"admin":"viewer";
  const active=req.body.active?1:0;
  if(target.id===req.session.user.id && (active===0 || role!=="admin")) return res.status(400).json({error:"You cannot remove your own admin access"});
  if(req.body.password){
    db.prepare("UPDATE users SET role=?,active=?,password_hash=? WHERE id=?").run(role,active,bcrypt.hashSync(String(req.body.password),12),id);
  }else{
    db.prepare("UPDATE users SET role=?,active=? WHERE id=?").run(role,active,id);
  }
  res.json({ok:true});
});
app.delete("/api/users/:id",admin,(req,res)=>{
  const id=Number(req.params.id);
  if(id===req.session.user.id) return res.status(400).json({error:"You cannot delete your own account"});
  db.prepare("DELETE FROM users WHERE id=?").run(id);
  res.json({ok:true});
});

app.put("/api/settings",admin,(req,res)=>{
  if(req.body.company_name!=null) setSetting("company_name",String(req.body.company_name).trim()||"Goyal Sales Inventory");
  if(req.body.footer!=null) setSetting("footer",String(req.body.footer).trim()||"Goyal Sales Inventory — Designed & Developed by Debu");
  res.json({ok:true});
});
app.post("/api/logo",admin,upload.single("logo"),(req,res)=>{
  if(!req.file) return res.status(400).json({error:"No logo file"});
  const ext=path.extname(req.file.originalname).toLowerCase()||".png";
  const safe="logo"+ext;
  const target=path.join(uploadDir,safe);
  fs.renameSync(req.file.path,target);
  const url="/uploads/"+safe+"?v="+Date.now();
  setSetting("logo",url);
  res.json({logo:url});
});

app.get("/api/export",auth,(req,res)=>{
  const q=String(req.query.q||"").trim();
  const like=`%${q}%`;
  const rows=q ? db.prepare(`SELECT product_name AS "Product Name",brand_name AS "Brand Name",
    product_code AS "Product Code",pieces_per_box AS "Pieces/Box",mrp AS "MRP",rate AS "Rate"
    FROM products WHERE product_name LIKE ? OR brand_name LIKE ? OR product_code LIKE ? ORDER BY id DESC`).all(like,like,like)
    : db.prepare(`SELECT product_name AS "Product Name",brand_name AS "Brand Name",
    product_code AS "Product Code",pieces_per_box AS "Pieces/Box",mrp AS "MRP",rate AS "Rate"
    FROM products ORDER BY id DESC`).all();
  // CSV that opens directly in Excel; frontend can also export .xlsx using the included SheetJS CDN.
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=[Object.keys(rows[0]||{"Product Name":"","Brand Name":"","Product Code":"","Pieces/Box":"","MRP":"","Rate":""}).map(esc).join(","),
    ...rows.map(r=>Object.values(r).map(esc).join(","))].join("\r\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition",`attachment; filename="goyal-sales-${q?"filtered":"inventory"}.csv"`);
  res.send("\ufeff"+csv);
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Goyal Sales Inventory running on http://localhost:${PORT}`));

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { authenticate } = require('./access');
const { writeAudit } = require('./audit');
const router = express.Router();
const secret = process.env.JWT_SECRET;
const cookieSecureSetting = process.env.COOKIE_SECURE || 'auto';
if (!['auto', 'true', 'false'].includes(cookieSecureSetting)) {
  throw new Error('COOKIE_SECURE must be auto, true, or false');
}
if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
router.post('/login', async (req,res)=>{
  const {username,password}=req.body||{};
  if(!username||!password) return res.status(400).json({error:'Nhập tên đăng nhập và mật khẩu'});
  const {rows}=await pool.query('SELECT id,username,password_hash,must_change_password FROM users WHERE username=$1 AND is_active=true',[username]);
  if(!rows[0] || !await bcrypt.compare(password,rows[0].password_hash)) return res.status(401).json({error:'Tên đăng nhập hoặc mật khẩu không đúng'});
  const mustChangePassword=rows[0].must_change_password||password==='123456';
  if(mustChangePassword&&!rows[0].must_change_password){
    await pool.query('UPDATE users SET must_change_password=true WHERE id=$1',[rows[0].id]);
  }
  const token=jwt.sign({sub:String(rows[0].id)},secret,{expiresIn:'8h'});
  const secureCookie = cookieSecureSetting === 'true'
    || (cookieSecureSetting === 'auto' && req.secure);
  res.cookie('session',token,{httpOnly:true,sameSite:'lax',secure:secureCookie,maxAge:8*60*60*1000});
  res.json({username:rows[0].username,mustChangePassword});
});
router.post('/change-password',authenticate,async(req,res)=>{
  const {currentPassword,newPassword}=req.body||{};
  if(typeof currentPassword!=='string'||typeof newPassword!=='string'){
    return res.status(400).json({error:'Nhập mật khẩu hiện tại và mật khẩu mới'});
  }
  if(newPassword.length<12||Buffer.byteLength(newPassword,'utf8')>72){
    return res.status(400).json({error:'Mật khẩu mới phải có từ 12 ký tự và tối đa 72 byte UTF-8'});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query(
      'SELECT password_hash FROM users WHERE id=$1 AND is_active=true FOR UPDATE',
      [req.user.id]
    );
    if(!rows[0]||!await bcrypt.compare(currentPassword,rows[0].password_hash)){
      await client.query('ROLLBACK');
      return res.status(400).json({error:'Mật khẩu hiện tại không đúng'});
    }
    if(await bcrypt.compare(newPassword,rows[0].password_hash)){
      await client.query('ROLLBACK');
      return res.status(400).json({error:'Mật khẩu mới phải khác mật khẩu hiện tại'});
    }
    const hash=await bcrypt.hash(newPassword,12);
    await client.query(
      'UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2',
      [hash,req.user.id]
    );
    await writeAudit(client,req,{
      action:'password_change',
      entityType:'user',
      entityId:null,
      entityName:req.user.username,
      details:{passwordChanged:true}
    });
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
});
router.post('/logout',(_req,res)=>res.clearCookie('session').json({ok:true}));
router.get('/me',authenticate,(req,res)=>{
  const {username,department,position,role,is_admin,must_change_password}=req.user;
  res.json({
    username,department,position,role:is_admin?'manager':role,isAdmin:is_admin,
    mustChangePassword:must_change_password
  });
});
module.exports=router;

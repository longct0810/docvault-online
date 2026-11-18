const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { authenticate } = require('./access');
const router = express.Router();
const secret = process.env.JWT_SECRET;
const secureCookie = process.env.COOKIE_SECURE === 'false'
  ? false
  : process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
router.post('/login', async (req,res)=>{
  const {username,password}=req.body||{};
  if(!username||!password) return res.status(400).json({error:'Nhập tên đăng nhập và mật khẩu'});
  const {rows}=await pool.query('SELECT id,username,password_hash FROM users WHERE username=$1 AND is_active=true',[username]);
  if(!rows[0] || !await bcrypt.compare(password,rows[0].password_hash)) return res.status(401).json({error:'Tên đăng nhập hoặc mật khẩu không đúng'});
  const token=jwt.sign({sub:String(rows[0].id)},secret,{expiresIn:'8h'});
  res.cookie('session',token,{httpOnly:true,sameSite:'lax',secure:secureCookie,maxAge:8*60*60*1000});
  res.json({username:rows[0].username});
});
router.post('/logout',(_req,res)=>res.clearCookie('session').json({ok:true}));
router.get('/me',authenticate,(req,res)=>{
  const {username,department,position,role,is_admin}=req.user;
  res.json({username,department,position,role:is_admin?'manager':role,isAdmin:is_admin});
});
module.exports=router;

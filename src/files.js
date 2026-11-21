const express=require('express');
const multer=require('multer');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const os=require('os');
const {promisify}=require('util');
const {execFile}=require('child_process');
const {pathToFileURL}=require('url');
const {pool}=require('./db');
const {writeAudit}=require('./audit');
const {authenticate,requirePasswordChangeComplete,hasRole,authorizeEntry,filterAccessible}=require('./access');
const {cleanName}=require('./file-names');
const router=express.Router();
const execFileAsync=promisify(execFile);
const root=path.resolve(process.env.STORAGE_DIR||'./storage'); fs.mkdirSync(root,{recursive:true});
const snapLibreOfficeCommon=path.join(os.homedir(),'snap','libreoffice','common');
const previewTempRoot=path.resolve(process.env.PREVIEW_TMP_DIR
  || (fs.existsSync(snapLibreOfficeCommon)?path.join(snapLibreOfficeCommon,'docvault-previews'):os.tmpdir()));
const max=Number(process.env.MAX_FILE_SIZE_MB||100)*1024*1024;
const upload=multer({storage:multer.diskStorage({destination:(_r,_f,cb)=>cb(null,root),filename:(_r,_f,cb)=>cb(null,crypto.randomUUID())}),limits:{fileSize:max}});
async function requireEntryPermission(req,res,entryId,permission){
  if(await authorizeEntry(req.user,entryId,permission))return true;
  res.status(403).json({error:permission==='view'?'Bạn không có quyền xem mục này':'Bạn không có quyền sửa mục này'});
  return false;
}
async function requireParentEdit(req,res,parentId){
  if(!parentId){
    if(req.user.is_admin)return true;
    res.status(403).json({error:'Chỉ quản trị viên được tạo hoặc di chuyển mục ở thư mục gốc'});
    return false;
  }
  if(!hasRole(req.user,'editor')&&!await isOwnedPrivateEntry(req.user,parentId)){
    res.status(403).json({error:'Vai trò Editor trở lên mới có quyền tạo hoặc sửa ngoài thư mục cá nhân'});
    return false;
  }
  return requireEntryPermission(req,res,parentId,'edit');
}
async function requireFileEditRole(req,res,entryId){
  if(hasRole(req.user,'editor')||await isOwnedPrivateEntry(req.user,entryId))return true;
  res.status(403).json({error:'Vai trò Editor trở lên mới có quyền sửa ngoài thư mục cá nhân'});
  return false;
}
async function requireFileDeleteRole(req,res,entryId){
  if(hasRole(req.user,'manager')||await isOwnedPrivateEntry(req.user,entryId))return true;
  res.status(403).json({error:'Chỉ vai trò Manager trở lên mới có quyền xóa ngoài thư mục cá nhân'});
  return false;
}
async function isOwnedPrivateEntry(user,entryId){
  const {rows}=await pool.query(`WITH RECURSIVE ancestry AS (
    SELECT id,parent_id,owner_user_id,is_private FROM entries WHERE id=$1
    UNION
    SELECT parent.id,parent.parent_id,parent.owner_user_id,parent.is_private
    FROM entries parent JOIN ancestry child ON child.parent_id=parent.id
  ) SELECT 1 FROM ancestry WHERE is_private=true AND owner_user_id=$2 LIMIT 1`,[entryId,user.id]);
  return rows.length>0;
}
router.use(authenticate,requirePasswordChangeComplete);
router.get('/entries',async(req,res)=>{
  const parent=req.query.parent||null;
  if(parent&&!await authorizeEntry(req.user,parent,'view'))return res.status(403).json({error:'Bạn không có quyền xem thư mục này'});
  const {rows}=await pool.query(`SELECT id,parent_id,name,kind,mime_type,size_bytes,created_at,updated_at,
    (is_private AND owner_user_id=$2) AS is_personal
    FROM entries WHERE parent_id IS NOT DISTINCT FROM $1::uuid ORDER BY kind DESC, lower(name)`,[parent,req.user.id]);
  res.json(await filterAccessible(req.user,rows));
});
router.get('/recent',async(req,res)=>{
  const {rows}=await pool.query(`WITH RECURSIVE paths AS (
    SELECT id,parent_id,name,kind,mime_type,size_bytes,created_at,updated_at,name::text AS full_path FROM entries WHERE parent_id IS NULL
    UNION ALL SELECT e.id,e.parent_id,e.name,e.kind,e.mime_type,e.size_bytes,e.created_at,e.updated_at,p.full_path||' / '||e.name FROM entries e JOIN paths p ON e.parent_id=p.id
  ) SELECT id,parent_id,name,kind,mime_type,size_bytes,created_at,updated_at,full_path FROM paths WHERE kind='file' ORDER BY updated_at DESC`);
  const accessible = (await filterAccessible(req.user,rows)).slice(0,20);
  if (!req.user.is_admin) accessible.forEach(entry => delete entry.full_path);
  res.json(accessible);
});
router.get('/search',async(req,res)=>{
  const query=typeof req.query.q==='string'?req.query.q.trim():'';
  if(!query)return res.json([]);
  const {rows}=await pool.query(`WITH RECURSIVE paths AS (
    SELECT id,parent_id,name,kind,mime_type,size_bytes,created_at,updated_at,name::text AS full_path FROM entries WHERE parent_id IS NULL
    UNION ALL SELECT e.id,e.parent_id,e.name,e.kind,e.mime_type,e.size_bytes,e.created_at,e.updated_at,p.full_path||' / '||e.name FROM entries e JOIN paths p ON e.parent_id=p.id
  ) SELECT id,parent_id,name,kind,mime_type,size_bytes,created_at,updated_at,full_path FROM paths WHERE name ILIKE '%'||$1||'%' ORDER BY lower(name)`,[query]);
  const accessible = (await filterAccessible(req.user,rows)).slice(0,200);
  if (!req.user.is_admin) accessible.forEach(entry => delete entry.full_path);
  res.json(accessible);
});
router.get('/folders',async(req,res)=>{
  const {rows}=await pool.query(`SELECT id,parent_id,name,kind,
    (is_private AND owner_user_id=$1) AS is_personal
    FROM entries WHERE kind='folder' ORDER BY lower(name)`,[req.user.id]);
  res.json(await filterAccessible(req.user,rows));
});
router.get('/entries/:id/permissions',async(req,res)=>{
  if(!await authorizeEntry(req.user,req.params.id,'manage'))return res.status(403).json({error:'Bạn không có quyền quản lý quyền truy cập'});
  const [{rows:entry},grants,users,departments,positions]=await Promise.all([
    pool.query('SELECT id,name,kind FROM entries WHERE id=$1',[req.params.id]),
    pool.query(`SELECT p.id,p.subject_type,p.user_id,p.subject_value,p.permission,u.username
      FROM entry_permissions p LEFT JOIN users u ON u.id=p.user_id
      WHERE p.entry_id=$1 ORDER BY p.subject_type,lower(COALESCE(u.username,p.subject_value))`,[req.params.id]),
    pool.query('SELECT id,username,department,position FROM users WHERE is_active=true ORDER BY lower(username)'),
    pool.query('SELECT DISTINCT ON (lower(department)) department AS value FROM users WHERE is_active=true AND department IS NOT NULL ORDER BY lower(department),department'),
    pool.query('SELECT DISTINCT ON (lower(position)) position AS value FROM users WHERE is_active=true AND position IS NOT NULL ORDER BY lower(position),position')
  ]);
  if(!entry[0])return res.sendStatus(404);
  res.json({entry:entry[0],permissions:grants.rows,users:users.rows,departments:departments.rows.map(row=>row.value),positions:positions.rows.map(row=>row.value)});
});
router.post('/entries/:id/permissions',async(req,res)=>{
  if(!await authorizeEntry(req.user,req.params.id,'manage'))return res.status(403).json({error:'Bạn không có quyền quản lý quyền truy cập'});
  const {subjectType,permission}=req.body;
  const userId=subjectType==='user'?Number(req.body.userId):null;
  let subjectValue=null;
  if(!['user','department','position'].includes(subjectType)||!['view','edit','manage'].includes(permission))return res.status(400).json({error:'Đối tượng hoặc mức quyền không hợp lệ'});
  if(subjectType==='user'&&(!Number.isSafeInteger(userId)||userId<=0))return res.status(400).json({error:'Tài khoản không hợp lệ'});
  if(subjectType!=='user'){
    const raw=typeof req.body.subjectValue==='string'?req.body.subjectValue.trim():'';
    if(!raw)return res.status(400).json({error:'Chọn phòng ban hoặc chức vụ'});
    const column=subjectType==='department'?'department':'position';
    const {rows}=await pool.query(`SELECT DISTINCT ON (lower(${column})) ${column} AS value FROM users WHERE is_active=true AND lower(${column})=lower($1) ORDER BY lower(${column}),${column}`,[raw]);
    if(!rows[0])return res.status(400).json({error:'Không tìm thấy nhóm đang hoạt động'});
    subjectValue=rows[0].value;
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let subjectName=subjectValue;
    if(subjectType==='user'){
      const {rows}=await client.query('SELECT id,username FROM users WHERE id=$1 AND is_active=true',[userId]);
      if(!rows[0]){await client.query('ROLLBACK');return res.status(400).json({error:'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa'})}
      subjectName=rows[0].username;
      await client.query(`INSERT INTO entry_permissions(entry_id,subject_type,user_id,permission,created_by)
        VALUES($1,'user',$2,$3,$4) ON CONFLICT(entry_id,user_id) WHERE subject_type='user'
        DO UPDATE SET permission=EXCLUDED.permission,created_by=EXCLUDED.created_by,created_at=now()`,
      [req.params.id,userId,permission,req.user.id]);
    }else{
      const {rows:users}=await client.query(`SELECT id FROM users WHERE is_active=true AND lower(${subjectType})=lower($1) LIMIT 1`,[subjectValue]);
      if(!users[0]){await client.query('ROLLBACK');return res.status(400).json({error:'Nhóm không còn tài khoản đang hoạt động'})}
      await client.query(`INSERT INTO entry_permissions(entry_id,subject_type,subject_value,permission,created_by)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(entry_id,subject_type,lower(subject_value))
        WHERE subject_type IN ('department','position')
        DO UPDATE SET permission=EXCLUDED.permission,created_by=EXCLUDED.created_by,created_at=now()`,
      [req.params.id,subjectType,subjectValue,permission,req.user.id]);
    }
    await client.query('UPDATE entries SET is_catalog_public=false,updated_at=now() WHERE id=$1 AND is_catalog_public=true',[req.params.id]);
    const {rows:entry}=await client.query('SELECT name,kind FROM entries WHERE id=$1',[req.params.id]);
    await writeAudit(client,req,{action:'permission_grant',entityType:entry[0].kind,entityId:req.params.id,entityName:entry[0].name,details:{subjectType,subjectName,permission}});
    await client.query('COMMIT');
    res.status(200).json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
});
router.delete('/entries/:id/permissions/:permissionId',async(req,res)=>{
  if(!await authorizeEntry(req.user,req.params.id,'manage'))return res.status(403).json({error:'Bạn không có quyền quản lý quyền truy cập'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query(`SELECT p.id,p.subject_type,p.permission,
      COALESCE(u.username,p.subject_value) AS subject_name,e.name,e.kind
      FROM entry_permissions p JOIN entries e ON e.id=p.entry_id
      LEFT JOIN users u ON u.id=p.user_id
      WHERE p.entry_id=$1 AND p.id=$2 FOR UPDATE OF p`,[req.params.id,req.params.permissionId]);
    if(!rows[0]){await client.query('ROLLBACK');return res.sendStatus(404)}
    await client.query('DELETE FROM entry_permissions WHERE id=$1',[req.params.permissionId]);
    await writeAudit(client,req,{action:'permission_revoke',entityType:rows[0].kind,entityId:req.params.id,entityName:rows[0].name,details:{subjectType:rows[0].subject_type,subjectName:rows[0].subject_name,permission:rows[0].permission}});
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
});
router.get('/activity',async(req,res)=>{
  if(!req.user.is_admin)return res.status(403).json({error:'Bạn không có quyền xem nhật ký hoạt động'});
  const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||50,1),100);
  const offset=Math.max(Number.parseInt(req.query.offset,10)||0,0);
  const [{rows},count]=await Promise.all([
    pool.query(`SELECT id,actor_username,action,entity_type,entity_id,entity_name,details,ip_address,created_at
      FROM activity_logs ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`,[limit,offset]),
    pool.query('SELECT count(*)::int AS total FROM activity_logs')
  ]);
  res.json({items:rows,total:count.rows[0].total});
});
router.post('/folders',async(req,res)=>{
  const name=cleanName(req.body.name);
  if(!name)return res.status(400).json({error:'Tên thư mục không hợp lệ'});
  const parent=req.body.parent||null;
  if(!await requireParentEdit(req,res,parent))return;
  let parentName=null;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(parent){
      const {rows}=await client.query("SELECT id,name FROM entries WHERE id=$1 AND kind='folder'",[parent]);
      if(!rows[0]){await client.query('ROLLBACK');return res.status(400).json({error:'Thư mục cha không hợp lệ'})}
      parentName=rows[0].name;
    }
    const id=crypto.randomUUID();
    await client.query("INSERT INTO entries(id,parent_id,name,kind) VALUES($1,$2,$3,'folder')",[id,parent,name]);
    await writeAudit(client,req,{action:'create',entityType:'folder',entityId:id,entityName:name,details:{parentName}});
    await client.query('COMMIT');
    res.status(201).json({id,name});
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
});
router.post('/upload',upload.array('files',20),async(req,res)=>{
  const added=[];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const parent=req.body.parent||null;
    if(!await requireParentEdit(req,res,parent)){
      await client.query('ROLLBACK');
      for(const file of req.files||[])fs.rmSync(file.path,{force:true});
      return;
    }
    let parentName=null;
    if(parent){
      const {rows}=await client.query("SELECT id,name FROM entries WHERE id=$1 AND kind='folder'",[parent]);
      if(!rows[0]){await client.query('ROLLBACK');for(const file of req.files||[])fs.rmSync(file.path,{force:true});return res.status(400).json({error:'Thư mục đích không hợp lệ'})}
      parentName=rows[0].name;
    }
    for(const file of req.files||[]){
      const id=crypto.randomUUID();
      const name=cleanName(file.originalname)||'tai-lieu';
      await client.query("INSERT INTO entries(id,parent_id,name,kind,disk_name,mime_type,size_bytes) VALUES($1,$2,$3,'file',$4,$5,$6)",[id,parent,name,file.filename,file.mimetype,file.size]);
      await writeAudit(client,req,{action:'upload',entityType:'file',entityId:id,entityName:name,details:{parentName,mimeType:file.mimetype,sizeBytes:file.size}});
      added.push({id,name});
    }
    await client.query('COMMIT');
    res.status(201).json(added);
  }catch(error){
    await client.query('ROLLBACK');
    for(const file of req.files||[])fs.rmSync(file.path,{force:true});
    throw error;
  }finally{client.release()}
});
router.get('/entries/:id/download',async(req,res)=>{
  if(!await requireEntryPermission(req,res,req.params.id,'view'))return;
  const {rows}=await pool.query("SELECT name,disk_name,mime_type FROM entries WHERE id=$1 AND kind='file'",[req.params.id]);
  if(!rows[0])return res.sendStatus(404);
  res.download(path.join(root,rows[0].disk_name),rows[0].name);
});
router.get('/entries/:id/preview',async(req,res,next)=>{
  if(!await requireEntryPermission(req,res,req.params.id,'view'))return;
  const {rows}=await pool.query("SELECT name,disk_name FROM entries WHERE id=$1 AND kind='file'",[req.params.id]);
  const file=rows[0];
  if(!file)return res.sendStatus(404);
  const ext=path.extname(file.name).toLowerCase();
  const source=path.join(root,file.disk_name);
  if(!fs.existsSync(source))return res.sendStatus(404);
  const videoMimeTypes=new Map([
    ['.mp4','video/mp4'],
    ['.m4v','video/mp4'],
    ['.webm','video/webm'],
    ['.ogv','video/ogg'],
    ['.ogg','video/ogg']
  ]);
  if(videoMimeTypes.has(ext)){
    res.type(videoMimeTypes.get(ext));
    res.setHeader('Content-Disposition','inline');
    res.setHeader('Cache-Control','private, no-store');
    return res.sendFile(source);
  }
  if(ext==='.pdf'){
    res.type('application/pdf');
    res.setHeader('Content-Disposition','inline; filename="preview.pdf"');
    res.setHeader('Cache-Control','private, no-store');
    return res.sendFile(source);
  }
  const officeExtensions=new Set(['.doc','.docx','.odt','.rtf','.xls','.xlsx','.ods','.ppt','.pptx','.odp']);
  if(!officeExtensions.has(ext))return res.status(415).json({error:'Không hỗ trợ xem trước định dạng tệp này'});
  await fs.promises.mkdir(previewTempRoot,{recursive:true});
  const temp=await fs.promises.mkdtemp(path.join(previewTempRoot,'docvault-preview-'));
  const input=path.join(temp,`document${ext}`);
  const output=path.join(temp,'document.pdf');
  const profile=path.join(temp,'profile');
  try{
    await fs.promises.copyFile(source,input);
  }catch(error){
    await fs.promises.rm(temp,{recursive:true,force:true});
    return next(error);
  }
  try{
    await execFileAsync('libreoffice',[
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless','--nologo','--nodefault','--nolockcheck','--norestore',
      '--convert-to','pdf','--outdir',temp,input
    ],{timeout:60000,maxBuffer:1024*1024});
  }catch(error){
    await fs.promises.rm(temp,{recursive:true,force:true});
    if(error.killed)return res.status(504).json({error:'Tài liệu mất quá nhiều thời gian để chuyển đổi'});
    if(error.code==='ENOENT'&&error.syscall?.startsWith('spawn')){
      return res.status(503).json({error:'Máy chủ chưa cài LibreOffice. Hãy cài LibreOffice Writer, Calc và Impress rồi khởi động lại IFC_Doc.'});
    }
    console.error('LibreOffice preview conversion failed', {
      file: file.name,
      exitCode: error.code,
      stderr: error.stderr?.toString().slice(0,2000),
      stdout: error.stdout?.toString().slice(0,2000)
    });
    return res.status(422).json({error:'LibreOffice không thể chuyển đổi tài liệu này. Hãy kiểm tra tệp có hợp lệ và không bị hỏng.'});
  }
  try{
    await fs.promises.access(output);
  }catch(error){
    await fs.promises.rm(temp,{recursive:true,force:true});
    if(error.code!=='ENOENT')return next(error);
    console.error('LibreOffice did not produce a PDF preview', {file:file.name});
    return res.status(422).json({error:'LibreOffice không tạo được bản xem trước. Hãy kiểm tra định dạng hoặc nội dung của tài liệu.'});
  }
  try{
    res.type('application/pdf');
    res.setHeader('Content-Disposition','inline; filename="preview.pdf"');
    res.setHeader('Cache-Control','private, no-store');
    res.sendFile(output,async error=>{
      await fs.promises.rm(temp,{recursive:true,force:true});
      if(error&&!res.headersSent)next(error);
    });
  }catch(error){
    await fs.promises.rm(temp,{recursive:true,force:true});
    return next(error);
  }
});
router.post('/entries/:id/copy',async(req,res)=>{
  const dest=req.body.parent||null;
  if(!await requireEntryPermission(req,res,req.params.id,'view'))return;
  if(!await requireParentEdit(req,res,dest))return;
  const client=await pool.connect();
  const copiedFiles=[];
  let destinationName=null;
  try{
    await client.query('BEGIN');
    if(dest){
      const {rows}=await client.query("SELECT id,name FROM entries WHERE id=$1 AND kind='folder'",[dest]);
      if(!rows[0]){await client.query('ROLLBACK');return res.status(400).json({error:'Thư mục đích không hợp lệ'})}
      destinationName=rows[0].name;
    }
    const {rows:source}=await client.query(`WITH RECURSIVE tree AS (
      SELECT id,parent_id,name,kind,disk_name,mime_type,size_bytes,0 AS depth FROM entries WHERE id=$1
      UNION ALL SELECT e.id,e.parent_id,e.name,e.kind,e.disk_name,e.mime_type,e.size_bytes,t.depth+1 FROM entries e JOIN tree t ON e.parent_id=t.id
    ) SELECT * FROM tree ORDER BY depth`,[req.params.id]);
    if(!source.length){await client.query('ROLLBACK');return res.sendStatus(404)}
    const ids=new Map();
    for(const item of source){
      const id=crypto.randomUUID();
      ids.set(item.id,id);
      const parent=item.depth===0?dest:ids.get(item.parent_id);
      let diskName=item.disk_name;
      if(item.kind==='file'){
        diskName=id;
        fs.copyFileSync(path.join(root,item.disk_name),path.join(root,diskName));
        copiedFiles.push(diskName);
      }
      await client.query('INSERT INTO entries(id,parent_id,name,kind,disk_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,parent,item.name,item.kind,diskName,item.mime_type,item.size_bytes]);
      const parentName=item.depth===0?destinationName:source.find(entry=>entry.id===item.parent_id)?.name||null;
      await writeAudit(client,req,{action:'copy',entityType:item.kind,entityId:id,entityName:item.name,details:{sourceName:item.name,destinationParentName:parentName}});
    }
    await client.query('COMMIT');
    res.status(201).json({id:ids.get(source[0].id)});
  }catch(error){
    await client.query('ROLLBACK');
    for(const name of copiedFiles)fs.rmSync(path.join(root,name),{force:true});
    throw error;
  }finally{client.release()}
});
router.patch('/entries/:id',async(req,res)=>{
  const name=cleanName(req.body.name);
  if(!name)return res.status(400).json({error:'Tên không hợp lệ'});
  if(!await requireFileEditRole(req,res,req.params.id))return;
  if(!await requireEntryPermission(req,res,req.params.id,'edit'))return;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query('SELECT name,kind FROM entries WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!rows[0]){await client.query('ROLLBACK');return res.json({ok:false})}
    const previousName=rows[0].name;
    if(previousName!==name){
      await client.query('UPDATE entries SET name=$1,updated_at=now() WHERE id=$2',[name,req.params.id]);
      await writeAudit(client,req,{action:'rename',entityType:rows[0].kind,entityId:req.params.id,entityName:name,details:{previousName,newName:name}});
    }
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
});
router.patch('/entries/:id/move',async(req,res)=>{
  const dest=req.body.parent||null;
  if(dest===req.params.id)return res.status(400).json({error:'Không thể chuyển vào chính thư mục đó'});
  if(!await requireFileEditRole(req,res,req.params.id))return;
  if(!await requireEntryPermission(req,res,req.params.id,'edit'))return;
  if(!await requireParentEdit(req,res,dest))return;
  const client=await pool.connect();
  let destinationName=null;
  try{
    await client.query('BEGIN');
    if(dest){
      const {rows}=await client.query("SELECT id,name FROM entries WHERE id=$1 AND kind='folder'",[dest]);
      if(!rows[0]){await client.query('ROLLBACK');return res.status(400).json({error:'Thư mục đích không hợp lệ'})}
      destinationName=rows[0].name;
    }
    const {rows:source}=await client.query('SELECT e.id,e.parent_id,e.name,e.kind,p.name AS parent_name FROM entries e LEFT JOIN entries p ON p.id=e.parent_id WHERE e.id=$1 FOR UPDATE OF e',[req.params.id]);
    if(!source[0]){await client.query('ROLLBACK');return res.sendStatus(404)}
    if(dest&&source[0].kind==='folder'){
      const {rows:descendants}=await client.query(`WITH RECURSIVE tree AS (
        SELECT id FROM entries WHERE id=$1 UNION ALL SELECT e.id FROM entries e JOIN tree t ON e.parent_id=t.id
      ) SELECT id FROM tree WHERE id=$2`,[req.params.id,dest]);
      if(descendants.length){await client.query('ROLLBACK');return res.status(400).json({error:'Không thể chuyển thư mục vào bên trong chính nó'})}
    }
    if(source[0].parent_id!==dest){
      await client.query('UPDATE entries SET parent_id=$1,updated_at=now() WHERE id=$2',[dest,req.params.id]);
      await writeAudit(client,req,{action:'move',entityType:source[0].kind,entityId:req.params.id,entityName:source[0].name,details:{previousParentName:source[0].parent_name,destinationParentName:destinationName}});
    }
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
});
router.delete('/entries/:id',async(req,res)=>{
  if(!await requireFileDeleteRole(req,res,req.params.id))return;
  if(!await requireEntryPermission(req,res,req.params.id,'edit'))return;
  const client=await pool.connect();
  let removed=[];
  try{
    await client.query('BEGIN');
    const {rows}=await client.query(`WITH RECURSIVE tree AS (
      SELECT e.id,e.parent_id,e.name,e.kind,e.disk_name,p.name AS parent_name FROM entries e LEFT JOIN entries p ON p.id=e.parent_id WHERE e.id=$1
      UNION ALL SELECT e.id,e.parent_id,e.name,e.kind,e.disk_name,p.name AS parent_name FROM entries e JOIN tree t ON e.parent_id=t.id LEFT JOIN entries p ON p.id=e.parent_id
    ) SELECT * FROM tree`,[req.params.id]);
    if(!rows.length){await client.query('ROLLBACK');return res.sendStatus(404)}
    removed=rows;
    for(const item of rows){
      await writeAudit(client,req,{action:'delete',entityType:item.kind,entityId:item.id,entityName:item.name,details:{parentName:item.parent_name}});
    }
    await client.query('DELETE FROM entries WHERE id=$1',[req.params.id]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
  for(const item of removed)if(item.kind==='file'&&item.disk_name)fs.rmSync(path.join(root,item.disk_name),{force:true});
  res.json({ok:true});
});
module.exports=router;

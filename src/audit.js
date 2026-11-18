async function writeAudit(client, req, { action, entityType, entityId, entityName, details = {} }) {
  await client.query(
    `INSERT INTO activity_logs
      (actor_id, actor_username, action, entity_type, entity_id, entity_name, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      req.user.sub || req.user.id,
      req.user.username,
      action,
      entityType,
      entityId,
      entityName,
      JSON.stringify(details),
      req.ip || null,
      req.get('user-agent')?.slice(0, 1000) || null
    ]
  );
}

module.exports = { writeAudit };

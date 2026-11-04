-- One-off, per env: real staff login; drop the early seed's fake operator logins (.test emails can't receive sign-in codes).
INSERT INTO members (id, email, name, role, operator_id, created_at) SELECT 'fe8da714-15e7-461a-bd91-d388252375d9', 'komugohq@gmail.com', 'Komugo Staff', 'staff', NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = 'komugohq@gmail.com');
DELETE FROM members WHERE email IN ('equestrian@komugo.test', 'climbing@komugo.test');

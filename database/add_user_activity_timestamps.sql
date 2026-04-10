-- Add last login / active timestamps for inactivity targeting
-- Stored as unix seconds to match existing users schema style.

ALTER TABLE `users`
  ADD COLUMN `last_login_at` INT NULL AFTER `deleted_at`,
  ADD COLUMN `last_active_at` INT NULL AFTER `last_login_at`;

CREATE INDEX `idx_users_last_active_at` ON `users` (`last_active_at`);
CREATE INDEX `idx_users_last_login_at` ON `users` (`last_login_at`);


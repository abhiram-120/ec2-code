-- Allow storing custom reminder frequencies like `every_30_days`.
-- This converts `reminder_frequency` from ENUM to VARCHAR.

ALTER TABLE `dunning_schedules`
  MODIFY COLUMN `reminder_frequency` VARCHAR(50) NOT NULL DEFAULT 'daily';


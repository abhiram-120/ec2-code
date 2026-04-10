/**
 * Applies zoom Plan A changes to the live dev/api-v3 codebase.
 * Run this inside the cloned repo root: node scripts/apply-zoom-patch.js
 * Safe to re-run — checks if already patched before modifying.
 */
const fs = require('fs');

let ok = 0;

// ─── 1. server.js — add zoomMeetingRetry require ─────────────────────────────
let serverJs = fs.readFileSync('server.js', 'utf8');
if (!serverJs.includes('zoomMeetingRetry')) {
  serverJs = serverJs.replace(
    "require('./src/cronjobs/riskProcess');",
    "require('./src/cronjobs/riskProcess');\nrequire('./src/cronjobs/zoomMeetingRetry');"
  );
  fs.writeFileSync('server.js', serverJs);
  console.log('✓ server.js — added zoomMeetingRetry');
  ok++;
} else {
  console.log('  server.js already patched');
}

// ─── 2. index.routes.js — add zoom webhook route BEFORE the 404 handler ──────
let indexRoutes = fs.readFileSync('src/routes/index.routes.js', 'utf8');
if (!indexRoutes.includes('zoom-webhook.routes')) {
  const zoomBlock = [
    '',
    '// Zoom webhook (no auth — Zoom calls this directly, HMAC verified inside controller)',
    "const zoomWebhookRoutes = require('./webhooks/zoom-webhook.routes');",
    "router.use('/webhooks/zoom', zoomWebhookRoutes);",
    '',
  ].join('\n');
  indexRoutes = indexRoutes.replace('// Handle 404 routes', zoomBlock + '// Handle 404 routes');
  fs.writeFileSync('src/routes/index.routes.js', indexRoutes);
  console.log('✓ index.routes.js — added zoom webhook route');
  ok++;
} else {
  console.log('  index.routes.js already patched');
}

// ─── 3. classes.js — add 3 zoom columns after zoom_meeting_id ─────────────────
let classesJs = fs.readFileSync('src/models/classes.js', 'utf8');
if (!classesJs.includes('zoom_unique_meeting_id')) {
  const zoomFields = `
        zoom_unique_meeting_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null,
            unique: true,
            comment: 'Unique per-class Zoom meeting ID (NOT the teacher PMI in zoom_id)'
        },
        zoom_unique_join_url: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
            comment: 'Join URL for the unique per-class Zoom meeting'
        },
        zoom_retry_count: {
            type: DataTypes.TINYINT.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Retry attempts for Zoom meeting creation failures (max 5)'
        },`;

  // Insert the 3 new fields right after the zoom_meeting_id block
  classesJs = classesJs.replace(
    /zoom_meeting_id:\s*\{\s*\n\s*type:\s*DataTypes\.BIGINT,\s*\n\s*defaultValue:\s*null\s*\n\s*\},/,
    `zoom_meeting_id: {
            type: DataTypes.BIGINT,
            defaultValue: null
        },${zoomFields}`
  );
  fs.writeFileSync('src/models/classes.js', classesJs);
  console.log('✓ classes.js — added zoom columns');
  ok++;
} else {
  console.log('  classes.js already has zoom columns');
}

// ─── 4. classes.js — add afterCreate hook ────────────────────────────────────
classesJs = fs.readFileSync('src/models/classes.js', 'utf8');
if (!classesJs.includes('afterCreate') || !classesJs.includes('ZoomService')) {
  const hook = `
// ─── afterCreate hook: create a unique Zoom meeting for every new class ─────
// Uses setImmediate so the outer Sequelize transaction has time to commit first.
// If Zoom is down, the class booking still succeeds — zoomMeetingRetry cron
// will pick it up and retry up to 5 times over the next 75 minutes.
Class.addHook('afterCreate', (classInstance) => {
    setImmediate(async () => {
        try {
            const teacher = await User.findByPk(classInstance.teacher_id, {
                attributes: ['id', 'email'],
            });

            if (!teacher?.email) {
                console.warn(\`[ZoomHook] No email for teacher_id=\${classInstance.teacher_id}, class_id=\${classInstance.id}\`);
                return;
            }

            const durationMinutes = Math.ceil(
                (new Date(classInstance.meeting_end) - new Date(classInstance.meeting_start)) / 60000
            ) || 55;

            const ZoomService = require('../services/zoom.service');
            const meeting = await ZoomService.createMeeting(
                teacher.email,
                classInstance.meeting_start,
                durationMinutes,
                \`Tulkka Class \${classInstance.id}\`
            );

            await Class.update(
                {
                    zoom_unique_meeting_id: String(meeting.id),
                    zoom_unique_join_url: meeting.join_url,
                },
                { where: { id: classInstance.id } }
            );

            console.log(\`[ZoomHook] class \${classInstance.id} → meeting \${meeting.id}\`);
        } catch (err) {
            console.error(\`[ZoomHook] Failed for class \${classInstance.id}: \${err.message}\`);
        }
    });
});

`;
  classesJs = classesJs.replace(/^(module\.exports\s*=\s*Class)/m, hook + '$1');
  fs.writeFileSync('src/models/classes.js', classesJs);
  console.log('✓ classes.js — added afterCreate hook');
  ok++;
} else {
  console.log('  classes.js already has afterCreate hook');
}

console.log(`\nDone — ${ok} file(s) patched.`);

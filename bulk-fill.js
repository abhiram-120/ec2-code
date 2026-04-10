require("dotenv").config();
const { Op } = require("sequelize");
const Class = require("./src/models/classes");
const User = require("./src/models/users");
const ZoomService = require("./src/services/zoom.service");

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  let processed = 0, succeeded = 0, failed = 0;

  while (true) {
    const classes = await Class.findAll({
      where: { zoom_unique_meeting_id: null, zoom_retry_count: { [Op.lt]: 5 }, created_at: { [Op.gte]: cutoff } },
      order: [["created_at", "ASC"]],
      limit: 50,
    });

    if (classes.length === 0) break;

    for (const c of classes) {
      try {
        const teacher = await User.findByPk(c.teacher_id, { attributes: ["id", "email"] });
        if (!teacher?.email) {
          await Class.update({ zoom_retry_count: 5 }, { where: { id: c.id } });
          failed++;
          continue;
        }
        const dur = Math.ceil((new Date(c.meeting_end) - new Date(c.meeting_start)) / 60000) || 55;
        const m = await ZoomService.createMeeting(teacher.email, c.meeting_start, dur, "Tulkka Class " + c.id);
        await Class.update({ zoom_unique_meeting_id: String(m.id), zoom_unique_join_url: m.join_url }, { where: { id: c.id } });
        succeeded++;
        await sleep(150);
      } catch (e) {
        await Class.update({ zoom_retry_count: c.zoom_retry_count + 1 }, { where: { id: c.id } });
        failed++;
      }
      processed++;
    }
    console.log(`Progress: ${succeeded} done, ${failed} failed, ${processed} processed`);
  }
  console.log(`COMPLETE — ${succeeded} meetings created, ${failed} skipped`);
}

run().catch(e => console.error(e.message));

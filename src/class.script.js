const { Op } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('./connection/connection');
const Class = require('./models/classes'); // adjust path

const BATCH_SIZE = 50;

async function updatePaymentStatus() {
  let offset = 0;

  while (true) {
    const classes = await Class.findAll({
      limit: BATCH_SIZE,
      offset,
      order: [['id', 'ASC']],
    });

    if (classes.length === 0) break;

    const updates = [];

    for (const cls of classes) {
      let paymentStatus = 'unpaid';

      if (cls.status === 'ended') {
        paymentStatus = 'paid';
      } else if (cls.status === 'cancelled') {
        if (cls.cancelledAt && cls.meetingStartTime) {
          const diffMinutes = Math.abs(
            moment(cls.cancelledAt).diff(moment(cls.meetingStartTime), 'minutes')
          );

          if (diffMinutes <= 30) {
            paymentStatus = 'paid';
          }
        }
      }

      updates.push(
        Class.update(
          { payment_status: paymentStatus },
          { where: { id: cls.id } }
        )
      );
      console.log(`Class ${cls.id} → ${paymentStatus}`);
    }

    await Promise.all(updates);

    console.log(`✅ Updated batch starting at offset ${offset}`);

    offset += BATCH_SIZE;
  }

  console.log('🎯 All classes updated successfully!');
}

updatePaymentStatus()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
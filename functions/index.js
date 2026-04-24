'use strict';

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

function buildReminderBody(taskData, jobData) {
  if (taskData && taskData.dueTime) {
    return `${taskData.text} due at ${taskData.dueTime}`;
  }
  if (jobData && jobData.dueTime) {
    return `${jobData.taskText || 'Planner task'} due at ${jobData.dueTime}`;
  }
  return taskData && taskData.text ? taskData.text : (jobData.taskText || 'Planner reminder');
}

function normalizeReminderLink(taskId, jobData) {
  return (jobData && jobData.clickUrl) || `planner.html#task=${encodeURIComponent(taskId)}`;
}

async function loadEnabledTokens() {
  const snapshot = await db.collection('push_registrations').where('enabled', '==', true).get();
  return snapshot.docs
    .map(doc => doc.data())
    .map(data => String(data.token || '').trim())
    .filter(Boolean);
}

exports.dispatchReminderJobs = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Etc/UTC',
  region: 'us-central1'
}, async () => {
  const nowIso = new Date().toISOString();
  const jobsSnapshot = await db.collection('reminder_jobs')
    .where('status', 'in', ['pending', 'snoozed'])
    .where('scheduledFor', '<=', nowIso)
    .limit(50)
    .get();

  if (jobsSnapshot.empty) {
    logger.info('No reminder jobs due.');
    return;
  }

  const tokens = await loadEnabledTokens();
  const batch = db.batch();

  for (const jobDoc of jobsSnapshot.docs) {
    const jobData = jobDoc.data() || {};
    const taskId = jobData.taskId || jobDoc.id;
    const taskRef = db.collection('planner_tasks').doc(taskId);
    const taskSnapshot = await taskRef.get();
    const timestamp = new Date().toISOString();
    const attemptCount = Number(jobData.attemptCount || 0) + 1;

    if (!taskSnapshot.exists) {
      batch.set(jobDoc.ref, {
        status: 'cancelled',
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        attemptCount
      }, { merge: true });
      continue;
    }

    const taskData = taskSnapshot.data() || {};
    if (taskData.completed || taskData.archived || !taskData.reminderDate || !taskData.reminderTime) {
      batch.set(jobDoc.ref, {
        status: 'cancelled',
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        attemptCount
      }, { merge: true });
      continue;
    }

    if (!tokens.length) {
      batch.set(jobDoc.ref, {
        status: 'failed',
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        attemptCount
      }, { merge: true });
      continue;
    }

    const link = normalizeReminderLink(taskId, jobData);
    const message = {
      tokens,
      notification: {
        title: 'Planner reminder',
        body: buildReminderBody(taskData, jobData)
      },
      data: {
        taskId,
        url: link,
        scheduledFor: jobData.scheduledFor || ''
      },
      webpush: {
        fcmOptions: {
          link
        },
        notification: {
          tag: `planner-reminder-${taskId}`,
          requireInteraction: true
        }
      }
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      const nextStatus = response.successCount > 0 ? 'sent' : 'failed';
      batch.set(jobDoc.ref, {
        status: nextStatus,
        sentAt: response.successCount > 0 ? timestamp : null,
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        attemptCount
      }, { merge: true });

      if (response.successCount > 0) {
        batch.set(taskRef, {
          reminderFired: true,
          reminderFiredAt: timestamp
        }, { merge: true });
      }
    } catch (error) {
      logger.error('Reminder dispatch failed', { taskId, error: error.message });
      batch.set(jobDoc.ref, {
        status: 'failed',
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        attemptCount
      }, { merge: true });
    }
  }

  await batch.commit();
});

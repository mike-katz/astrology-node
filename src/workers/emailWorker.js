// Database-based email worker
// Jobs are automatically processed from the database queue
// Processes emails one by one (line by line) until table is empty

const { emailQueue } = require('../utils/emailQueue');

// Start processing queue immediately
// Will continue processing until table is empty (no timeout)
emailQueue.processQueue();

console.log('✅ Database email worker started');
console.log('📧 Processing emails one by one from database queue (line by line)');
console.log('🔄 Will continue until all jobs are processed (no timeout)');

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down email worker...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Shutting down email worker...');
    process.exit(0);
});

module.exports = emailQueue;

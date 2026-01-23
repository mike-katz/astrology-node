const db = require('../db');
require('dotenv').config();

/**
 * Database-based email queue (similar to Laravel queue)
 * Jobs are stored in database and deleted after successful processing
 */
class EmailQueue {
    constructor() {
        this.queueName = 'email-queue';
        this.concurrency = 1; // Process one email at a time (line by line)
        this.maxRetries = 3;
        this.processing = false;
        this.activeJobs = 0;
    }

    /**
     * Add email job to database queue
     * @param {string} toEmail - Recipient email address
     * @param {string} subject - Email subject
     * @param {string} templateName - Template name (without .html extension)
     * @param {object} variables - Template variables
     * @returns {Promise} Job promise
     */
    async add(toEmail, subject, templateName, variables = {}) {
        try {
            const payload = {
                toEmail,
                subject,
                templateName,
                variables,
            };

            const now = new Date();
            
            console.log(`📝 Attempting to add email job to queue for: ${toEmail}`);
            
            const [job] = await db('jobs').insert({
                queue: this.queueName,
                payload: JSON.stringify(payload),
                attempts: 0,
                available_at: now, // Available immediately
                created_at: now,
            }).returning('id');

            console.log(`📧 Email job added to database queue: ${job.id} for ${toEmail}`);
            
            // Start processing if not already running
            this.processQueue();
            
            return { id: job.id, ...payload };
        } catch (error) {
            console.error('❌ Error adding email to database queue:', error);
            console.error('Error message:', error.message);
            console.error('Error code:', error.code);
            console.error('Error stack:', error.stack);
            throw error;
        }
    }

    /**
     * Process the queue from database
     * Processes emails one by one (line by line) until table is empty
     */
    async processQueue() {
        if (this.processing) {
            return;
        }

        this.processing = true;

        // Process emails one by one sequentially until table is empty
        while (true) {
            const job = await this.getNextJob();
            
            if (!job) {
                // No more jobs available in table
                break;
            }

            this.activeJobs++;
            try {
                // Wait for current job to complete before processing next
                await this.processJob(job);
            } catch (error) {
                // Error already logged in processJob
            } finally {
                this.activeJobs--;
            }
        }

        this.processing = false;
        
        // Check again after a short delay to pick up any new jobs
        // This ensures continuous processing until table is empty
        setTimeout(() => {
            this.processQueue();
        }, 500);
    }

    /**
     * Get next available job from database
     */
    async getNextJob() {
        try {
            const now = new Date();
            
            // Get next available job (not reserved, available now, and not exceeded max attempts)
            const job = await db('jobs')
                .where('queue', this.queueName)
                .where('available_at', '<=', now)
                .whereNull('reserved_at')
                .where('attempts', '<', this.maxRetries)
                .orderBy('id', 'asc')
                .first();

            if (!job) {
                return null;
            }

            // Reserve the job (mark as reserved)
            const reservedAt = new Date();
            await db('jobs')
                .where('id', job.id)
                .update({ reserved_at: reservedAt });

            return {
                id: job.id,
                ...JSON.parse(job.payload),
                attempts: job.attempts,
            };
        } catch (error) {
            console.error('❌ Error getting next job:', error);
            return null;
        }
    }

    /**
     * Process a single email job
     */
    async processJob(job) {
        try {
            // Import sendMailActual dynamically to avoid circular dependency
            const { sendMailActual } = require('./sendMail');
            
            console.log(`📤 Processing email job ${job.id} for ${job.toEmail} (attempt ${job.attempts + 1})`);
            
            const result = await sendMailActual(job.toEmail, job.subject, job.templateName, job.variables);
            
            // Delete job after successful processing (like Laravel)
            await db('jobs').where('id', job.id).delete();
            
            console.log(`✅ Email sent successfully: ${job.id} - ${job.toEmail} (deleted from queue)`);
            return result;
        } catch (error) {
            console.error(`❌ Failed to send email ${job.id} for ${job.toEmail}:`, error.message);
            
            const newAttempts = job.attempts + 1;
            
            if (newAttempts < this.maxRetries) {
                // Retry with exponential backoff
                const delay = Math.min(2000 * Math.pow(2, newAttempts - 1), 10000); // Max 10 seconds
                const availableAt = new Date(Date.now() + delay);
                
                console.log(`🔄 Retrying email ${job.id} in ${delay}ms...`);
                
                // Update job: increment attempts, clear reservation, set new available time
                await db('jobs')
                    .where('id', job.id)
                    .update({
                        attempts: newAttempts,
                        reserved_at: null,
                        available_at: availableAt,
                    });
            } else {
                // Max attempts reached - delete failed job (or you can move to failed_jobs table)
                await db('jobs').where('id', job.id).delete();
                console.error(`❌ Email ${job.id} failed after ${this.maxRetries} attempts (deleted from queue)`);
            }
            
            throw error;
        }
    }

    /**
     * Get queue status
     */
    async getStatus() {
        const now = new Date();
        
        const [pending] = await db('jobs')
            .where('queue', this.queueName)
            .where('available_at', '<=', now)
            .whereNull('reserved_at')
            .where('attempts', '<', this.maxRetries)
            .count('* as count');

        const [reserved] = await db('jobs')
            .where('queue', this.queueName)
            .whereNotNull('reserved_at')
            .count('* as count');

        return {
            pending: parseInt(pending.count),
            reserved: parseInt(reserved.count),
            activeJobs: this.activeJobs,
            processing: this.processing,
        };
    }
}

// Create singleton instance
const emailQueue = new EmailQueue();

/**
 * Add email job to queue
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} templateName - Template name (without .html extension)
 * @param {object} variables - Template variables
 * @returns {Promise} Job promise
 */
async function addEmailToQueue(toEmail, subject, templateName, variables = {}) {
    try {
        const job = await emailQueue.add(toEmail, subject, templateName, variables);
        return job;
    } catch (error) {
        console.error('❌ Error adding email to queue:', error.message);
        throw error;
    }
}

console.log('✅ Database email queue initialized (Laravel-style)');
console.log('📧 Queue will be processed by email worker');

module.exports = {
    emailQueue,
    addEmailToQueue,
};

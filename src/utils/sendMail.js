const Nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { addEmailToQueue } = require("./emailQueue");

/**
 * Actual email sending function (used by worker)
 * This function performs the actual email sending
 */
async function sendMailActual(toEmail, subject, templateName, variables = {}) {

    const sender = {
        address: process.env.SMTP_ADDRESS,
        name: subject,
    };
    // const recipients = [
    //     toEmail
    // ];
    const transporter = Nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false, // STARTTLS
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        tls: {
            rejectUnauthorized: false // optional (use only if needed)
        }
    });

    // 2. Load your HTML template
    const templatePath = path.join(__dirname, "templates", `${templateName}.html`);
    let htmlTemplate = fs.readFileSync(templatePath, "utf8");

    // 3. Fetch settings from database for social media icons
    try {
        const settings = await db('settings').first();
        if (settings) {
            variables.facebookUrl = settings.facebook || '';
            variables.instagramUrl = settings.instagram || '';
            variables.xUrl = settings.x || '';
            variables.linkedinUrl = settings.linkedin || '';
            variables.youtubeUrl = settings.youtube || '';
        } else {
            // Default empty if no settings found
            variables.facebookUrl = '';
            variables.instagramUrl = '';
            variables.xUrl = '';
            variables.linkedinUrl = '';
            variables.youtubeUrl = '';
        }
    } catch (error) {
        console.error("Error fetching settings:", error);
        // Set defaults on error
        variables.facebookUrl = '';
        variables.instagramUrl = '';
        variables.xUrl = '';
        variables.linkedinUrl = '';
        variables.youtubeUrl = '';
    }

    // 4. Add current year if not provided (for dynamic year in footer)
    if (!variables.currentYear) {
        variables.currentYear = new Date().getFullYear();
    }

    // 5. Generate social media icons HTML dynamically
    const socialIcons = [];
    const iconConfig = [
        { url: variables.facebookUrl, icon: 'Facebook.png', alt: 'Facebook' },
        { url: variables.instagramUrl, icon: 'Instagram.png', alt: 'Instagram' },
        { url: variables.xUrl, icon: 'x.png', alt: 'X' },
        { url: variables.linkedinUrl, icon: 'Linkedin.png', alt: 'LinkedIn' },
        { url: variables.youtubeUrl, icon: 'Youtube.png', alt: 'YouTube' }
    ];

    iconConfig.forEach(({ url, icon, alt }) => {
        if (url && url.trim()) {
            socialIcons.push(`
                <td style="padding-left:8px;">
                    <a href="${url}" target="_blank" style="text-decoration:none;">
                        <img src="https://astroguruji2026.s3.ap-south-1.amazonaws.com/avatars/${icon}" width="28" alt="${alt}">
                    </a>
                </td>
            `);
        }
    });

    variables.socialMediaIcons = socialIcons.join('');

    // 6. Replace template variables like {{name}}, {{message}}, etc.
    for (const key in variables) {
        const regex = new RegExp(`{{${key}}}`, "g");
        htmlTemplate = htmlTemplate.replace(regex, variables[key]);
    }

    try {
        const info = await transporter.sendMail({
            from: sender,
            to: toEmail,
            subject: subject,
            html: htmlTemplate
        });
        console.log("✅ Email sent:", info?.messageId);
        return info;
    } catch (error) {
        console.error("❌ Email failed:", error);
        throw error;
    }
}

/**
 * Queue wrapper function (default export)
 * This function adds email to queue instead of sending immediately
 * User doesn't have to wait for email to be sent
 */
async function sendMail(toEmail, subject, templateName, variables = {}) {
    try {
        console.log(`📨 sendMail called for: ${toEmail}, template: ${templateName}`);
        // Add email to queue - returns immediately without waiting
        const result = await addEmailToQueue(toEmail, subject, templateName, variables);
        console.log(`✅ Email queued successfully: ${toEmail}`);
        return { queued: true, message: 'Email added to queue', jobId: result.id };
    } catch (error) {
        console.error("❌ Error queuing email:", error);
        console.error("Error details:", error.message, error.stack);
        // If queue fails, you can optionally fall back to sending immediately
        // For now, we'll just log the error
        throw error;
    }
}

// Export both functions
module.exports = sendMail;
module.exports.sendMailActual = sendMailActual;
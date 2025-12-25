const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const AWS = require('aws-sdk');
require('dotenv').config();

async function generateInvoicePDF(data) {
    const { transaction_id, } = data;
    console.log("data", data);
    const templatePath = path.join(__dirname, 'invoice.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // 🔁 Replace placeholders
    for (const [key, value] of Object.entries(data)) {
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    html = html.replace('{{date}}', new Date().toDateString())
    // html = html
    //     .replace('{{transaction_id}}', transaction_id)
    //     .replace('{{utr}}', utr)
    //     .replace('{{date}}', new Date().toDateString())
    //     .replace('{{with_tax_amount}}', with_tax_amount)
    //     .replace('{{gst}}', gst)
    //     .replace('{{address}}', address)
    //     .replace('{{city}}', city)
    //     .replace('{{pincode}}', pincode)
    //     .replace('{{total_in_word}}', total_in_word)
    //     .replace('{{amount}}', amount);

    const fileName = `invoice_${transaction_id.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const outputPath = path.join(__dirname, 'pdfs', fileName);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true
    });

    await browser.close();

    const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        signatureVersion: "v4",
    });

    const fileContent = fs.readFileSync(outputPath);
    const Key = `invoice/${transaction_id}.pdf`;
    const bucketName = process.env.AWS_BUCKET_NAME
    const params = {
        Bucket: bucketName,
        Key,
        Body: fileContent,
    };

    await s3.putObject(params).promise();
    await fs.unlinkSync(outputPath)
    const s3FileUrl = `https://${bucketName}.s3.amazonaws.com/${Key}`;
    return s3FileUrl;
    // return outputPath;
}

module.exports = generateInvoicePDF;

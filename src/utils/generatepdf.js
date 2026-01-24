const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const AWS = require('aws-sdk');
// const imgPath = `file://${path.resolve(__dirname, 'logo.svg')}`;

require('dotenv').config();
// const { PDFDocument, StandardFonts } = require('pdf-lib');
// const wkhtmltopdf = require("wkhtmltopdf");
// const pdf = require("html-pdf");
const STATE_SHORT = {
    "Andhra Pradesh": "AP",
    "Arunachal Pradesh": "AR",
    "Assam": "AS",
    "Bihar": "BR",
    "Chhattisgarh": "CG",
    "Goa": "GA",
    "Gujarat": "GJ",
    "Haryana": "HR",
    "Himachal Pradesh": "HP",
    "Jharkhand": "JH",
    "Karnataka": "KA",
    "Kerala": "KL",
    "Madhya Pradesh": "MP",
    "Maharashtra": "MH",
    "Manipur": "MN",
    "Meghalaya": "ML",
    "Mizoram": "MZ",
    "Nagaland": "NL",
    "Odisha": "OD",
    "Punjab": "PB",
    "Rajasthan": "RJ",
    "Sikkim": "SK",
    "Tamil Nadu": "TN",
    "Telangana": "TS",
    "Tripura": "TR",
    "Uttar Pradesh": "UP",
    "Uttarakhand": "UK",
    "West Bengal": "WB",
    "Delhi": "DL"
};

function getStateShortCode(address) {
    if (!address) return null;

    for (const state in STATE_SHORT) {
        if (address.toLowerCase().includes(state.toLowerCase())) {
            return STATE_SHORT[state];
        }
    }
    return null;
}

async function generateInvoicePDF(data) {
    const { transaction_id, } = data;
    console.log("data", data);
    const templatePath = path.join(__dirname, 'invoice.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    const stateCode = getStateShortCode(data?.city);
    data.place = stateCode || ''
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/snap/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });
    const page = await browser.newPage();

    // Handle null/undefined values for address section - hide lines if null
    // Check if address, city, or pincode exist
    const hasCity = data.city && data.city.trim() !== '';
    const hasPincode = data.pincode && data.pincode.trim() !== '';

    if (!hasCity && !hasPincode) {
        // Remove the entire address line if all are null/empty
        html = html.replace(/<div id="address-line">[\s\S]*?<\/div>/g, '');
    } else {
        // Replace null values with empty string
        if (!hasCity) data.city = '';
        if (!hasPincode) data.pincode = '';
    }

    // Handle place of supply
    if (!data.place || data.place.trim() === '') {
        // Remove the place of supply line if null/empty
        html = html.replace(/<div id="place-line">[\s\S]*?<\/div>/g, '');
    }

    // Explicitly remove {{address}} placeholder if it exists (safety check)
    html = html.replace(/\{\{address\}\}/g, '');

    // 🔁 Replace placeholders
    for (const [key, value] of Object.entries(data)) {
        const replacementValue = value !== null && value !== undefined ? value : '';
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), replacementValue);
    }

    html = html.replace('{{date}}', new Date().toDateString())
    // html = html.replace('{{imgPath}}', imgPath)
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

    await page.setContent(html, {
        waitUntil: 'networkidle0'
    });

    await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        // margin: {
        //     top: '20mm',
        //     bottom: '20mm',
        //     left: '15mm',
        //     right: '15mm'
        // }
    });

    await browser.close();

    // const options = {
    //     format: "A4",
    //     border: "10mm",
    //     timeout: 30000,
    // };

    // await new Promise((resolve, reject) => {
    //     pdf.create(html, options).toFile(outputPath, (err, res) => {
    //         if (err) return reject(err);
    //         resolve(res);
    //     });
    // });

    const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        signatureVersion: "v4",
    });

    const fileContent = fs.readFileSync(outputPath);
    const bucketName = process.env.AWS_BUCKET_NAME;
    const Key = `invoice/${transaction_id}.pdf`;

    await s3.putObject({
        Bucket: bucketName,
        Key,
        Body: fileContent,
        ContentType: 'application/pdf'
    }).promise();

    fs.unlinkSync(outputPath);

    const s3FileUrl = `https://${bucketName}.s3.amazonaws.com/${Key}`;

    return s3FileUrl; // ✅ ACTUAL RESPONSE




    // Create PDF
    // const pdfDoc = await PDFDocument.create();
    // const page = pdfDoc.addPage([595, 842]); // A4 size

    // const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    // page.drawText(html, {
    //     x: 50,
    //     y: 800,
    //     size: 14,
    //     font
    // });

    // // Save PDF
    // const pdfBytes = await pdfDoc.save();

    // fs.writeFileSync(outputPath, pdfBytes);


    // wkhtmltopdf(html, { output: fileName });
    // return "test";
    // const page = await browser.newPage();
    // await page.setContent(html, { waitUntil: 'networkidle0' });

    // await page.pdf({
    //     path: outputPath,
    //     format: 'A4',
    //     printBackground: true
    // });

    // await browser.close();


    // return outputPath;
}

module.exports = generateInvoicePDF;

const db = require('../db');
const generateInvoicePDF = require('../utils/generatepdf');


function numberToIndianWords(amount) {
    if (amount === undefined || amount === null) return '';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function convertBelowThousand(num) {
        let str = '';
        if (num > 99) { str += ones[Math.floor(num / 100)] + ' Hundred '; num %= 100; }
        if (num > 19) { str += tens[Math.floor(num / 10)] + ' '; num %= 10; }
        if (num > 0) str += ones[num] + ' ';
        return str.trim();
    }
    function convertNumber(num) {
        let result = '';
        if (num >= 10000000) { result += convertBelowThousand(Math.floor(num / 10000000)) + ' Crore '; num %= 10000000; }
        if (num >= 100000) { result += convertBelowThousand(Math.floor(num / 100000)) + ' Lakh '; num %= 100000; }
        if (num >= 1000) { result += convertBelowThousand(Math.floor(num / 1000)) + ' Thousand '; num %= 1000; }
        result += convertBelowThousand(num);
        return result.trim();
    }
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let words = convertNumber(rupees) + ' Rupees';
    if (paise > 0) words += ' and ' + convertNumber(paise) + ' Paise';
    return words + ' Only';
}
const runInvoiceCron = async () => {
    try {
        const paymentRow = await db('payments')
            .where({ status: 'success' })
            .where(function () {
                this.whereNull('invoice').orWhere('invoice', '');
            })
            .orderBy('id', 'desc')
            .first();

        if (!paymentRow) {
            console.log('[InvoiceCron] No payment with status success and invoice null. Skip.');
            return;
        }

        const user = await db('users').where({ id: paymentRow.user_id }).first();
        if (!user) {
            console.warn('[InvoiceCron] User not found for payment id', paymentRow.id);
            return;
        }

        const gst = Number(paymentRow?.gst) || 0;
        const with_tax_amount = Number(Number(gst) + Number(paymentRow?.amount)).toFixed(2);
        const total_in_word = numberToIndianWords(Number(with_tax_amount));

        const data = {
            transaction_id: paymentRow.transaction_id || '',
            utr: paymentRow.utr || paymentRow.transaction_id || '',
            amount: Number(paymentRow?.amount).toFixed(2),
            with_tax_amount: String(with_tax_amount),
            gst: Number(gst).toFixed(2),
            city: user?.city_state_country || '',
            pincode: user?.pincode || '',
            total_in_word,
        };

        const invoice = await generateInvoicePDF(data);
        await db('payments').where({ id: paymentRow.id }).update({ invoice });

        const balanceLog = await db('balancelogs')
            .where({ user_id: paymentRow.user_id })
            .where('message', 'like', `%${paymentRow.transaction_id || paymentRow.id}%`)
            .where(function () {
                this.whereNull('invoice').orWhere('invoice', '');
            })
            .first();
        if (balanceLog) {
            await db('balancelogs').where({ id: balanceLog.id }).update({ invoice });
        }

        console.log('[InvoiceCron] Processed 1 payment, invoice updated for payment id', paymentRow.id);
    } catch (err) {
        console.error('[InvoiceCron] error:', err?.message);
    }
};

runInvoiceCron();

const { BlobServiceClient } = require('@azure/storage-blob');

const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
);

async function uploadToAzure(buffer, fileName) {
    const containerClient = blobServiceClient.getContainerClient(
        process.env.AZURE_STORAGE_CONTAINER_NAME
    );

    const blockBlobClient = containerClient.getBlockBlobClient(fileName);

    // await blockBlobClient.uploadData(buffer);
    await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: {
            blobContentType: "audio/mpeg",          // 👈 IMPORTANT
            blobContentDisposition: "inline"        // 👈 IMPORTANT
        }
    });
    console.log("blockBlobClient", blockBlobClient)
    return blockBlobClient.url; // final public/private URL
}

async function deleteFileFromAzure(filePath = '') {
    new Promise(async (resolve, reject) => {
        try {
            const match = filePath.match(/\.blob\.core\.windows\.net\/[^/]+\/(.+)$/);
            if (!match || !match[1]) {
                reject(new Error('Invalid Azure blob URL'));
                return;
            }
            const blobName = decodeURIComponent(match[1]);
            const containerClient = getContainerClient();
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            const result = await blockBlobClient.deleteIfExists();
            resolve({ data: result });
        } catch (err) {
            console.error('Azure delete error:', err);
            reject(err);
        }
    });
}

module.exports = { uploadToAzure, deleteFileFromAzure }
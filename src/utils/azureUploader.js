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
module.exports = { uploadToAzure }
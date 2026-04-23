const { BlobServiceClient } = require('@azure/storage-blob');

const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
);

function getContainerClient() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
    if (!connectionString || !containerName) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME are required');
    }
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient.getContainerClient(containerName);
}


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
    return new Promise(async (resolve, reject) => {
        try {
            let blobName = '';

            // Azure Blob URL support
            const azureMatch = filePath.match(/\.blob\.core\.windows\.net\/[^/]+\/(.+)$/);

            // CDN Base URL support
            const cdnBaseUrl = process.env.AZURE_STORAGE_BASE_URL;

            if (azureMatch && azureMatch[1]) {
                blobName = decodeURIComponent(azureMatch[1]);
            } else if (filePath.startsWith(cdnBaseUrl)) {
                blobName = decodeURIComponent(
                    filePath.replace(cdnBaseUrl, '')
                );
            }

            if (!blobName) {
                return reject(new Error('Invalid Azure blob/CDN URL'));
            }

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

async function uploadImageToAzure(directoryPath, image, type) {
    return new Promise(async (resolve, reject) => {
        try {
            const containerClient = getContainerClient();
            const file = image.buffer;
            const originalFileName = image.originalname;
            const splitedFileName = originalFileName.split('.');
            const fileName = `${Date.now()}@$!${splitedFileName[0]}.${splitedFileName[splitedFileName.length - 1]}`;

            const folderName =
                type === 'chat' ? process.env.CHAT_FOLDER_NAME
                    : type === 'pandit' ? process.env.PANDIT_FOLDER_NAME
                        : type === 'document' ? process.env.DOCUMENT_FOLDER_NAME
                            : type === 'upload' ? 'upload'
                                : type === 'support' ? (process.env.SUPPORT_FOLDER_NAME || 'support')
                                    : process.env.CHAT_FOLDER_NAME || 'extra';

            const blobName = folderName ? `${folderName}/${fileName}` : fileName;
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);

            await blockBlobClient.uploadData(file, {
                blobHTTPHeaders: {
                    blobContentType: image.mimetype || 'application/octet-stream',
                },
            });

            const url = blockBlobClient.url;
            resolve({
                data: {
                    Location: url,
                    key: blobName,
                    url,
                    blobName,
                },
            });
        } catch (err) {
            console.error('Azure upload error:', err);
            reject(err);
        }
    });
}

exports.uploadBufferToAzure = (buffer, filename, contentType, type = 'exports') =>
    new Promise(async (resolve, reject) => {
        try {
            const containerClient = getContainerClient();
            const folderName = type === 'exports' ? 'exports' : type || 'exports';
            const blobName = folderName ? `${folderName}/${filename}` : filename;
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);

            await blockBlobClient.uploadData(buffer, {
                blobHTTPHeaders: {
                    blobContentType: contentType || 'application/octet-stream',
                },
            });

            resolve({
                url: `${process.env.AZURE_STORAGE_BASE_URL}${blobName}`,
                blobName,
            });
        } catch (err) {
            console.error('Azure buffer upload error:', err);
            reject(err);
        }
    });

module.exports = { uploadToAzure, deleteFileFromAzure, uploadImageToAzure }
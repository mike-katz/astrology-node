/**
 * Azure Blob Storage uploader – same API as uploader.js (S3).
 * Env: AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER_NAME,
 *      CHAT_FOLDER_NAME, PANDIT_FOLDER_NAME, DOCUMENT_FOLDER_NAME (optional, same as S3)
 */

const { BlobServiceClient } = require('@azure/storage-blob');

function getContainerClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  if (!connectionString || !containerName) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME are required');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(containerName);
}

/**
 * Upload image/file to Azure Blob Storage.
 * @param {string} directoryPath - unused, kept for same signature as S3 uploader
 * @param {object} image - multer file: { buffer, originalname, mimetype }
 * @param {string} type - 'chat' | 'pandit' | 'document' | 'upload' | 'support'
 * @returns {Promise<{ data: { url, blobName } }>}
 */
exports.uploadImageToAzure = (directoryPath, image, type) =>
  new Promise(async (resolve, reject) => {
    try {
      const containerClient = getContainerClient();
      const file = image.buffer;
      const originalFileName = image.originalname;
      const splitedFileName = originalFileName.split('.');
      const fileName = `${Date.now().toString()}@$!${splitedFileName[0]}.${splitedFileName[splitedFileName.length - 1]}`;

      const folderName =
        type === 'chat' ? process.env.CHAT_FOLDER_NAME
          : type === 'pandit' ? process.env.PANDIT_FOLDER_NAME
            : type === 'document' ? process.env.DOCUMENT_FOLDER_NAME
              : type === 'upload' ? 'upload'
                : type === 'support' ? (process.env.SUPPORT_FOLDER_NAME || 'support')
                  : process.env.CHAT_FOLDER_NAME || '';

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

/**
 * Delete file from Azure Blob Storage by full blob URL.
 * @param {string} filePath - full URL e.g. https://<account>.blob.core.windows.net/<container>/path/to/file
 * @returns {Promise<{ data }>}
 */
exports.deleteFileFromAzure = (filePath = '') =>
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

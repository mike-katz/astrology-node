const aws = require('aws-sdk');

exports.uploadImageTos3 = ((directoryPath, image, type) => new Promise(async (resolve, reject) => {
  const s3bucket = new aws.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  });
  const file = image.buffer;

  const originalFileName = image.originalname;
  const splitedFileName = originalFileName.split('.');
  fileName = `${new Date().getTime().toString()}@$!${splitedFileName[0]}.${splitedFileName[splitedFileName.length - 1]}`;

  const folderName = type === 'chat' ? process.env.CHAT_FOLDER_NAME
    : type === 'pandit' ? process.env.PANDIT_FOLDER_NAME
      : type === 'document' ? process.env.DOCUMENT_FOLDER_NAME
        : process.env.CHAT_FOLDER_NAME || '';

  // const folderName = process.env.PANDIT_FOLDER_NAME
  const s3Params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: `${folderName}/${fileName}`,
    Body: file,
    Expires: 60,
    ContentType: image.mimetype,
    // ACL: 'public-read'
  };

  s3bucket.upload(s3Params, (err, data) => {
    if (err) {
      console.log(err);
      reject(err);
    } else {
      resolve({
        data,
      });
    }
  });
}));

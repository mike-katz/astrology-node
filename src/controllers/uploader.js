const aws = require('aws-sdk');

exports.uploadImageTos3 = ((directoryPath, image, type) => new Promise(async (resolve, reject) => {
  const s3bucket = new aws.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  });
  const file = image.buffer;

  const originalFileName = image.originalname;
  const splitedFileName = originalFileName.split('.');
  fileName = `${new Date().getTime().toString()}.${splitedFileName[splitedFileName.length - 1]}`;

  // const folderName = type === 'withdraw' ? process.env.AWS_FOLDER_NAME_WITHDRAWAL
  //   : type === 'pandit' ? process.env.AWS_FOLDER_NAME_DEPOSIT
  //     : type === 'qrcode' ? process.env.AWS_FOLDER_NAME : process.env.AWS_FOLDER_NAME_CHAT_FILE || '';
  const folderName = process.env.PANDIT_FOLDER_NAME
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

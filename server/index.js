const express = require('express');
const path = require('path');
const multiparty = require('multiparty');
const fse = require('fs-extra');
const cors = require("cors");
const bodyParser = require('body-parser');

const UPLOAD_DIR = path.resolve(__dirname, 'uploads')

const app = express();

// 提取文件后缀名
const extractExt = filename => {
	return filename.slice(filename.lastIndexOf('.'), filename.length)
}

app.use(bodyParser.json());
app.use(cors());

app.post('/upload', function (req, res) {
  const form = new multiparty.Form()

  form.parse(req, async (err, fields, files) => {
    const fileHash = fields['fileHash'][0]
    const chunkHash = fields['chunkHash'][0]

    // 临时存放切片的文件夹 
    const chunkDir = path.resolve(UPLOAD_DIR, fileHash)

    // 如果目录不存在，则创建一个新的
    if (!fse.existsSync(chunkDir)) {
      await fse.mkdirs(chunkDir)
    }

    // 如果存在，将所有的切片放到对应的目录里面
    const oldPath = files['chunk'][0]['path']
    await fse.move(oldPath, path.resolve(chunkDir, chunkHash))

    res.status(200).json({
      ok: true,
      msg: '上传成功'
    })
  })
})

app.post('/merge', async function(req, res) {
  const { fileHash, fileName, size } = req.body
  // console.log(fileHash);
  // console.log(fileName);

  const filePath = path.resolve(UPLOAD_DIR, fileHash + extractExt(fileName))
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash)

  if(fse.existsSync(filePath)) {
    res.status(200).json({
      ok: true,
      msg: '合并成功'
    })
    return;
  }

  if (!fse.existsSync(chunkDir)) {
    res.status(410).json({
      ok: true,
      msg: '合并失败，请重新上传'
    })
    return;
  }

  const allChunks = await fse.readdir(chunkDir)

  allChunks.sort((a, b) => {
    return a.split('-')[1] - b.split('-')[1]
  })

  // console.log(filePath);

  const list = allChunks.map((chunkPath, index) => {
    return new Promise(resolve => {
      const readSream = fse.createReadStream(path.resolve(chunkDir, chunkPath))
      const writeSream = fse.createWriteStream(filePath, {
        start: index * size,
        end: (index + 1) * size
      })
  
      readSream.on('end', async () => {
        await fse.unlink(path.resolve(chunkDir, chunkPath))
        resolve()
      })
  
      readSream.pipe(writeSream)
    })
  })

  await Promise.all(list)
  fse.rmdirSync(chunkDir)


  res.status(200).json({
    ok: true,
    msg: '合并成功'
  })
})

app.post('/verify', async function (req, res) {
  const { fileHash, fileName } = req.body

  const filePath = path.resolve(UPLOAD_DIR, fileHash + extractExt(fileName))
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash)

  let allChunks = []
  // 拿到之前已经上传过的分片
  if (fse.existsSync(chunkDir)) {
    allChunks = await fse.readdir(chunkDir)
  }

  if (fse.existsSync(filePath)) {
    res.status(200).json({
      ok: true,
      data: {
        shouldUpload: false
      }
    })
  } else {
    res.status(200).json({
      ok: true,
      data: {
        shouldUpload: true,
        existsChunks: allChunks
      }
    })
  }
})


app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
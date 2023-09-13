<script setup lang="ts">
import { ref } from 'vue'
import SparkMD5 from 'spark-md5'

// 1MB = 1024KB = 1024 * 1024B
const CHUNK_SIZE = 1024 * 1024

const fileName = ref<string>('')
const fileSize = ref<number>(0)
const fileHash = ref<string>('')

// 文件分片
const createFileChunks = (file: File) => {
  let cur = 0
  const chunks = []
  while(cur < file.size) {
    chunks.push(file.slice(cur, cur + CHUNK_SIZE))
    cur += CHUNK_SIZE
  }

  return chunks
}

// 计算hash值
const calcuteHash = (chunks: Array<Blob>) => {
  return new Promise(resolve => {
    const targets: Blob[] = []
    const spark = new SparkMD5.ArrayBuffer()
    // 1. 第一个和最后一个切片全部参与计算
    // 2. 中间的切片只有前两个字节、中间两个字节、后面两个字节参与计算
    chunks.forEach((chunk, index) => {
      if (index === 0 || index === chunks.length - 1) {
        targets.push(chunk)
      } else {
        targets.push(chunk.slice(0, 2)) // 前两个字节
        targets.push(chunk.slice(CHUNK_SIZE / 2, CHUNK_SIZE / 2 + 2)) // 中间两个字节
        targets.push(chunk.slice(CHUNK_SIZE - 2, CHUNK_SIZE)) // 后面两个字节
      }
    })

    const fileReader = new FileReader();
    fileReader.readAsArrayBuffer(new Blob(targets))

    fileReader.onload = (e) => {
      spark.append((e.target as FileReader).result); 
      resolve(spark.end());
    }
  })
}

// 合并请求
const mergeRequest = () => {
  fetch('http://localhost:3000/merge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value,
      size: CHUNK_SIZE
    })
  }).then(() => {
    alert('合并成功！')
  })
}

// 分片上传
const uploadChunks = async (chunks: Array<Blob>, existsChunks: string[]) => {
  const data = chunks.map((chunk, index) => {
    return {
      fileName: fileName.value,
      fileHash: fileHash.value,
      chunkHash: fileHash.value + '-' + index,
      chunk: chunk
    }
  })

  const formDatas = data
    .filter((item) => !existsChunks.includes(item.chunkHash))
    .map((item) => {
      const formData = new FormData()
      formData.append('fileName', item.fileName)
      formData.append('fileHash', item.fileHash)
      formData.append('chunkHash', item.chunkHash)
      formData.append('chunk', item.chunk)

      return formData
    })

  // [1,2,3,4,6,7]
  const max = 6 // 最大并行请求数
  const taskPool: any = [] // 请求队列
  let index = 0

  while(index < formDatas.length) {
    const task = fetch('http://localhost:3000/upload', {
      method: 'POST',
      body: formDatas[index]
    })

    task.then(() => {
      // 执行完后把当前任务从任务队列中删除
      taskPool.splice(taskPool.findIndex((item: any) => item === task))
    })
    taskPool.push(task)
    if (taskPool.length === max) {
      await Promise.race(taskPool)
    }
    index ++
  }

  await Promise.all(taskPool)

  // 所有分片上传完成后，通知服务器可以合并了
  mergeRequest()
}

/**
 * 验证该文件是否需要上传，文件通过hash生成唯一，改名后也是不需要再上传的，也就相当于秒传
 */
 const verifyUpload = async () => {
  return fetch('http://127.0.0.1:3000/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: fileName.value,
      fileHash: fileHash.value
    })
  })
  .then((response) => response.json())
  .then((data) => {
    return data; // data中包含对应的表示服务器上有没有该文件的查询结果
  });
}

const handleUpload = async (e: Event) => {
  // console.log((e.target as HTMLInputElement).files); // 伪数组
  // 读取文件
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  // console.log(files[0]);
  fileName.value = files[0].name
  fileSize.value = files[0].size

  // 文件分片  
  const chunks = createFileChunks(files[0])

  // 计算hash值
  const hash = await calcuteHash(chunks)
  fileHash.value = hash as string
  // console.log(hash);

  // 校验是否需要上传
  const { data } = await verifyUpload()
  console.log(data);
  
  if (!data.shouldUpload) {
    alert('秒传成功')
    return;
  }
  // 分片上传
  uploadChunks(chunks, data.existsChunks)
}

</script>

<template>
  <h1>大文件上传</h1>
  <input @change="handleUpload" type="file">
</template>

<style scoped>
</style>

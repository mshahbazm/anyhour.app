import { PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '../../env'
import { ApiError } from '../http/apiError'
import { getR2Storage } from './r2Storage'
import type { iKnowledgeOwner } from './owner'
import {
  detectDocumentFormat,
  documentFormats,
  unreadableReason,
} from './documents'

export const uploadLimitBytes = 10 * 1024 * 1024

// Validates and stores the original file. Text is extracted later by the worker.
export async function storeUpload(file: File, owner: iKnowledgeOwner) {
  if (file.size > uploadLimitBytes)
    throw new ApiError(422, 'file_too_large', 'Maximum file size is 10 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = detectDocumentFormat({
    bytes,
    mimeType: file.type,
    fileName: file.name,
  })
  if (!format)
    throw new ApiError(
      422,
      'unsupported_file',
      unreadableReason({ bytes, mimeType: file.type, fileName: file.name }),
    )
  if (!bytes.length) throw new ApiError(422, 'empty_file', 'File is empty')
  const mimeType = documentFormats[format].mimeTypes[0]
  const objectKey = `organizations/${owner.organizationId}/${crypto.randomUUID()}`
  await getR2Storage().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: objectKey,
      Body: bytes,
      ContentType: mimeType,
    }),
  )
  return { objectKey, mimeType }
}

export { deleteStoredObject as deleteUpload } from './r2Storage'

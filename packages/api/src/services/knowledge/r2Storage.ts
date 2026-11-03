import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from '../../env'
import { ApiError } from '../http/apiError'

let storage: S3Client | undefined

export function getR2Storage() {
  if (
    !env.R2_ENDPOINT ||
    !env.R2_BUCKET ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  )
    throw new ApiError(
      503,
      'storage_unconfigured',
      'File storage is not configured',
    )
  storage ??= new S3Client({
    region: 'auto',
    maxAttempts: 3,
    requestHandler: {
      requestTimeout: 30_000,
      connectionTimeout: 5_000,
      throwOnRequestTimeout: true,
    },
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })
  return storage
}

export async function deleteStoredObject(objectKey: string) {
  await getR2Storage().send(
    new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: objectKey }),
  )
}

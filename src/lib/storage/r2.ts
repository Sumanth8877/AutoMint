export const r2 = {
  endpoint: process.env.R2_ENDPOINT || '',
  bucket: process.env.R2_BUCKET || '',
  accessKey: process.env.R2_ACCESS_KEY || '',
  secretKey: process.env.R2_SECRET_KEY || '',
};

export function getR2PublicUrl(key: string): string {
  const endpoint = r2.endpoint.replace(/\/$/, '');
  const bucket = r2.bucket;
  return `${endpoint}/${bucket}/${key}`;
}
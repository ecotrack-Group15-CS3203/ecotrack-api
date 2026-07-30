import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

export const UPLOADS_ROOT = join(process.cwd(), 'uploads');
export const INCIDENT_IMAGES_DIR = join(UPLOADS_ROOT, 'incidents');
export const TASK_PHOTOS_DIR = join(UPLOADS_ROOT, 'tasks');
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, accept: boolean) => void,
) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    callback(
      new BadRequestException(
        'Only JPEG, PNG, WEBP or HEIC images are allowed',
      ),
      false,
    );
    return;
  }
  callback(null, true);
}

export const incidentImageUploadOptions = {
  storage: diskStorage({
    destination: INCIDENT_IMAGES_DIR,
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: imageFileFilter,
};

export const taskPhotoUploadOptions = {
  storage: diskStorage({
    destination: TASK_PHOTOS_DIR,
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: imageFileFilter,
};

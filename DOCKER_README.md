# تشغيل المنصة باستخدام Docker

هذا المشروع مهيأ للتشغيل باستخدام Docker و Docker Compose لتسهيل عملية الرفع والتشغيل على السيرفر.

## المتطلبات
- Docker
- Docker Compose

## خطوات التشغيل

1. **بناء وتشغيل الحاويات:**
   قم بتشغيل الأمر التالي في المجلد الرئيسي للمشروع:
   ```bash
   docker-compose up --build -d
   ```

2. **الوصول للمنصة:**
   - الواجهة الأمامية (Frontend): [http://localhost:3000](http://localhost:3000)
   - الواجهة الخلفية (Backend API): [http://localhost:5000](http://localhost:5000)

## ملاحظات هامة
- **قاعدة البيانات:** يتم استخدام **PostgreSQL** حالياً. تأكد من ضبط رابط قاعدة البيانات الصحيح في متغير `DATABASE_URL`.
- **تغيير الإعدادات:** يمكنك تعديل المتغيرات البيئية (Environment Variables) في ملف `docker-compose.yml` أو في إعدادات السيرفر (مثل Dokploy).
- **الإنتاج (Production):** عند الرفع على سيرفر حقيقي، تأكد من تغيير `NEXT_PUBLIC_API_URL` في ملف `docker-compose.yml` ليشير إلى رابط السيرفر الخاص بك.

## أوامر مفيدة
- لإيقاف التشغيل: `docker-compose down`
- لعرض السجلات (Logs): `docker-compose logs -f`
- لتحديث قاعدة البيانات داخل الحاوية: 
  ```bash
  docker-compose exec backend npx prisma migrate dev
  ```

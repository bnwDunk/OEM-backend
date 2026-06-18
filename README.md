# OEM Backend API

Express API สำหรับระบบ OEM login โดยใช้ MySQL เป็นฐานข้อมูล และออก token แบบ OAuth Bearer token

## Setup

1. สร้างไฟล์ `.env` จาก `.env.example`

```bash
copy .env.example .env
```

2. แก้ค่า MySQL และ secret ใน `.env`

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=oem_app
JWT_ACCESS_SECRET=change-this-access-secret
JWT_REFRESH_SECRET=change-this-refresh-secret
```

3. สร้าง database/table

```bash
mysql -u root -p < database/schema.sql
```

4. รัน API

```bash
npm run dev
```

API จะอยู่ที่ `http://localhost:4000`

## Demo Account

```txt
email: admin@oem.local
password: password123
```

## Endpoints

### Health

```http
GET /api/health
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@oem.local",
  "password": "password123"
}
```

หรือใช้ OAuth token endpoint:

```http
POST /api/oauth/token
Content-Type: application/json

{
  "grant_type": "password",
  "username": "admin@oem.local",
  "password": "password123"
}
```

Response:

```json
{
  "token_type": "Bearer",
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": "15m",
  "user": {
    "id": 1,
    "name": "OEM Admin",
    "email": "admin@oem.local",
    "role": "admin"
  }
}
```

### Me

```http
GET /api/auth/me
Authorization: Bearer <access_token>
```

### Refresh Token

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refresh_token": "<refresh_token>"
}
```

หรือ:

```http
POST /api/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token>"
}
```

### Logout

```http
POST /api/auth/logout
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "refresh_token": "<refresh_token>"
}
```

## Note

ระบบนี้เป็น OAuth-style token login สำหรับ first-party app:

- `access_token` ใช้ส่งผ่าน `Authorization: Bearer`
- `refresh_token` ถูก hash แล้วเก็บใน MySQL
- refresh token rotate ทุกครั้งที่เรียก `/api/auth/refresh`

ถ้าต้องการ OAuth provider จริง เช่น Google, Microsoft หรือ Line Login ให้เพิ่ม provider flow แยกใน route `/api/auth/:provider`.

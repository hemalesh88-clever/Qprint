# Qprint by HEMALESH
> **Upload. Pay. Track. Print. Collect.**
> Real-Time College Printing and Xerox Queue Management Platform

---

## 1. Overview & Architecture

**Qprint** is a production-grade web platform engineered for college xerox and printing centers (such as RIT Xerox Center). It automates the printing lifecycle for students, faculty, and shop operators, eliminating physical queues through automated file uploads, real-time FIFO queue tracking, dynamic pricing, and dual payment options.

### Key Roles
1. **Student**: Upload assignments, lab records, project reports, track queue status in real time, receive collection alerts.
2. **Teacher / Faculty**: Submit examination question papers, lecture handouts, and syllabus documents with priority flags.
3. **Shop Handler**: Dedicated operational terminal for `RITXeroxShop` to manage queues, start printing, mark orders ready for collection, verify UPI payments, update pricing tiers, and inspect audit logs.

---

## 2. Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Motion.
- **Backend**: Node.js & Express 4 (in `server.ts`), Vite middleware.
- **Database & Persistence**: Persistent file-backed JSON database (`data/qprint-db.json`) with audit logging.
- **Real-Time Communication**: Server-Sent Events (SSE) stream (`/api/events`) for live queue updates and instant notifications.
- **Authentication**: Firebase Authentication + Native password/mobile OTP backend bridge.
- **Payments**: Manual UPI QR (with UTR verification) and Razorpay Test Mode (`rzp_test_Ts1E8IJ905rEp4`).

---

## 3. Pre-Configured Accounts

### Shop Handler Account
- **Username**: `RITXeroxShop`
- **Password**: `Rit@1432#`
- **Role**: `handler` (pre-provisioned on backend initialization with secure salt and SHA-256 hash)

---

## 4. Official College Pricing Tiers

Calculated authoritatively on the backend using decimal-safe integer paise arithmetic:

| Total Page Count | Price per Page | Example |
|---|---|---|
| **1 – 10 pages** | ₹2.00 / page | 5 pages = ₹10.00 |
| **11 – 50 pages** | ₹1.50 / page | 20 pages = ₹30.00 |
| **51 – 100 pages** | ₹1.00 / page | 75 pages = ₹75.00 |
| **101+ pages** | ₹0.75 / page | 200 pages = ₹150.00 |

*Additional Options:*
- Color Print: +₹8.00 / page
- Soft Spiral Binding: +₹30.00
- Hard Bound Project: +₹120.00

---

## 5. Status Workflow

```
[Confirmed] ──> [Waiting in Queue] ──> [Printing] ──> [Ready for Collection] ──> [Collected]
```

- When the Handler marks an order **Ready for Collection**, an instant in-app notification is pushed to the customer:
  > *"Your printout is ready for collection!"*
- When the order is handed over and marked **Collected**, it moves into the **Completed Orders Archive**.

---

## 6. Windows Development & Startup Guide

### Prerequisites
- Node.js 18+ or 20+
- npm 9+

### Setup Commands (Windows PowerShell or CMD)
```bash
# 1. Clone or navigate to the directory
cd C:\Users\Hemalesh\Downloads\Qprint

# 2. Install dependencies
npm install

# 3. Start development server (Full-Stack Express + Vite)
npm run dev

# 4. Open in browser
http://localhost:3000
```

### Running Automated Test Suite
```bash
# Runs boundary pricing tests and workflow tests
npx tsx --test src/server.test.ts src/utils/pricing.test.ts src/utils/orderRules.test.ts
```

---

## 7. Firebase Repair & Configuration

The application is pre-configured with the user's project settings:
- **API Key**: `AIzaSyDZbi6cKyB8zueqUa299tS9uvRE3I1J9Ck`
- **Auth Domain**: `qprint-7890.firebaseapp.com`
- **Project ID**: `qprint-7890`
- **App ID**: `1:793873573863:web:ddb28e7d5a40a541d8ff42`

### Resolving `auth/api-key-not-valid`
1. In the Google Cloud Console / Firebase Console under **APIs & Services > Credentials**, inspect the API key.
2. Under **Application restrictions**, ensure HTTP referrers include `localhost:3000` and the Cloud hosting URL.
3. Under **API restrictions**, ensure **Identity Toolkit API** is enabled.
4. In the Firebase Console under **Authentication > Settings > Authorized domains**, add `localhost`.
5. The application includes a fallback authentication bridge so students and faculty can register and sign in seamlessly even if external domain whitelisting is pending.

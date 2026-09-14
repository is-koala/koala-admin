import { adminAssignmentFixture } from "./admin-assignment";

/**
 * koala-backend#265 detay DTO'ları — `AdminAssignmentDetailDto`,
 * `AdminPaymentDto`, `AdminPayoutDetailDto`, `AdminJobDto`/`AdminJobDetailDto`
 * — kaynak `record`lardan yazıldı ve 14.09.2026'da canlı OpenAPI (0.9.18)
 * ile karşılaştırıldı: alan adları birebir.
 */

export const ASSIGNMENT_ID = "9a1c0f10-0001-4c00-8000-0000000000aa";
export const JOB_ID = "9a1c0f10-0001-4c00-8000-0000000000bb";
export const PAYMENT_ID = "7b000000-0000-4000-8000-000000000071";
export const PAYOUT_ID = "9c000000-0000-4000-8000-000000000033";
export const DISPUTE_ID = "6d000000-0000-4000-8000-000000000061";
export const REPORT_ID = "5e000000-0000-4000-8000-000000000051";

export function adminPaymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    jobAssignmentId: ASSIGNMENT_ID,
    jobId: JOB_ID,
    jobTitle: "Garsonluk",
    companyId: "c0000000-0000-4000-8000-0000000000c1",
    companyName: "Koala Kafe",
    worker: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
    employer: { id: "e-1", firstName: "Mehmet", lastName: "Demir", username: "mehmet" },
    status: "SUCCEEDED",
    currency: "TRY",
    pricingVersion: "v1",
    pricing: {
      pricingVersion: "v1",
      currency: "TRY",
      workerPayout: "1240.50",
      serviceFeeRate: "0.1000",
      serviceFeeAmount: "137.83",
      employerTotal: "1378.33",
    },
    workerPayout: "1240.50",
    commissionAmount: "137.83",
    commissionRate: "0.1000",
    totalCharged: "1378.33",
    conversationId: "conv-000071",
    providerPaymentId: "iyz-pay-000071",
    providerTransactionId: "iyz-tx-000071",
    failureReason: null,
    verificationAttempts: 2,
    nextVerificationAt: null,
    completedAt: "2026-09-01T17:05:00.000000000Z",
    createdAt: "2026-09-01T17:00:00.000000000Z",
    updatedAt: "2026-09-01T17:05:00.000000000Z",
    refunds: [
      {
        id: "8f000000-0000-4000-8000-000000000081",
        paymentId: PAYMENT_ID,
        amount: "1378.33",
        currency: "TRY",
        status: "COMPLETED",
        reason: "İşveren talebi",
        providerRefundId: "iyz-refund-000081",
        completedAt: "2026-09-03T09:00:00.000000000Z",
        createdAt: "2026-09-03T08:55:00.000000000Z",
        updatedAt: "2026-09-03T09:00:00.000000000Z",
      },
    ],
    ...overrides,
  };
}

export function adminAssignmentDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...adminAssignmentFixture(),
    payments: [{ id: PAYMENT_ID, status: "SUCCEEDED", createdAt: "2026-09-01T17:00:00Z" }],
    payout: { id: PAYOUT_ID, status: "PROCESSING", createdAt: "2026-09-02T08:00:00Z" },
    disputes: [{ id: DISPUTE_ID, status: "RESOLVED", createdAt: "2026-09-02T09:00:00Z" }],
    reports: [{ id: REPORT_ID, status: "OPEN", createdAt: "2026-09-02T10:00:00Z" }],
    ...overrides,
  };
}

export function adminPayoutDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYOUT_ID,
    jobAssignmentId: ASSIGNMENT_ID,
    jobId: JOB_ID,
    jobTitle: "Garsonluk",
    companyId: "c0000000-0000-4000-8000-0000000000c1",
    companyName: "Koala Kafe",
    worker: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", email: "ayse@example.com" },
    employer: { id: "e-1", firstName: "Mehmet", lastName: "Demir", email: "mehmet@example.com" },
    paymentId: PAYMENT_ID,
    maskedIban: "TR** **** **** **** **** **12 34",
    amount: "1240.50",
    currency: "TRY",
    status: "PROCESSING",
    providerReference: "iyz-transaction-000033",
    settlementReference: null,
    failureReason: null,
    processingAt: "2026-09-02T08:05:00.000000000Z",
    completedAt: null,
    createdAt: "2026-09-02T08:00:00.000000000Z",
    updatedAt: "2026-09-02T08:05:00.000000000Z",
    settlementTasks: [
      {
        id: "4a000000-0000-4000-8000-000000000041",
        operation: "APPROVE",
        status: "SUCCEEDED",
        attempts: 1,
        nextAttemptAt: null,
        lastError: null,
        providerTransactionId: "iyz-tx-000071",
        providerReference: "iyz-transaction-000033",
        amount: "1240.50",
        completedAt: "2026-09-02T08:05:00.000000000Z",
        createdAt: "2026-09-02T08:00:00.000000000Z",
        updatedAt: "2026-09-02T08:05:00.000000000Z",
      },
      {
        id: "4a000000-0000-4000-8000-000000000042",
        operation: "REFUND",
        status: "FAILED",
        attempts: 3,
        nextAttemptAt: "2026-09-02T12:00:00.000000000Z",
        lastError: "Provider timeout",
        providerTransactionId: null,
        providerReference: null,
        amount: "1240.50",
        completedAt: null,
        createdAt: "2026-09-02T09:00:00.000000000Z",
        updatedAt: "2026-09-02T11:00:00.000000000Z",
      },
    ],
    paymentAttempts: [{ id: PAYMENT_ID, status: "SUCCEEDED", createdAt: "2026-09-01T17:00:00Z" }],
    ...overrides,
  };
}

export function adminJobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    title: "Garsonluk",
    status: "OPEN",
    employerType: "COMPANY",
    type: "ONE_TIME",
    salaryType: "HOURLY",
    salary: 155.0,
    pricing: {
      pricingVersion: "v1",
      currency: "TRY",
      workerPayout: "1240.50",
      serviceFeeRate: "0.1000",
      serviceFeeAmount: "137.83",
      employerTotal: "1378.33",
    },
    startDateTime: "2026-09-20T09:00:00",
    endDateTime: "2026-09-20T17:00:00",
    employer: { id: "e-1", firstName: "Mehmet", lastName: "Demir", email: "mehmet@example.com" },
    companyId: "c1000000-0000-4000-8000-000000000001",
    companyName: "Koala Kafe",
    cityName: "İstanbul",
    districtName: "Kadıköy",
    headcount: 3,
    applicationCount: 12,
    assignmentCount: 2,
    createdAt: "2026-09-10T08:00:00.000000000Z",
    updatedAt: "2026-09-11T08:00:00.000000000Z",
    ...overrides,
  };
}

export function adminJobDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...adminJobFixture(),
    description: "Hafta sonu kahvaltı servisi.",
    duties: "Sipariş alma, servis, masa toplama.",
    sector: "Yeme-içme",
    position: "Garson",
    dressCode: "Siyah üst, siyah alt",
    category: {
      id: "9a1c0f10-0001-4c00-8000-000000000002",
      name: "Garsonluk",
      code: "WAITER",
      requiresInsurance: false,
    },
    minAge: 18,
    maxAge: 45,
    insuranceRequired: false,
    experienceRequired: true,
    company: {
      id: "c1000000-0000-4000-8000-000000000001",
      name: "Koala Kafe",
      email: "info@koalakafe.test",
      logoUrl: null,
      phoneNumber: "+90 216 000 00 00",
      website: null,
      description: null,
      taxNumber: "1234567890",
      type: "LIMITED",
    },
    address: {
      id: "ad000000-0000-4000-8000-000000000001",
      countryId: null,
      countryName: "Türkiye",
      countryCode: "TR",
      cityId: null,
      cityName: "İstanbul",
      districtId: null,
      districtName: "Kadıköy",
      components: {
        neighborhood: "Caferağa Mah.",
        thoroughfare: "Moda Cad.",
        siteName: null,
        block: null,
        buildingName: null,
        buildingNumber: "12",
        floor: "2",
        unitNumber: "5",
        postalCode: "34710",
        additionalDirections: "Eczanenin üstü",
      },
      position: { latitude: 40.98, longitude: 29.03 },
      displayAddress: null,
      confirmedAt: null,
      canonicalVersion: 1,
      needsReview: false,
    },
    addressPublic: false,
    images: [
      {
        id: "1a000000-0000-4000-8000-000000000011",
        url: "https://storage.koala.test/jobs/1.jpg",
        sortOrder: 0,
        cover: true,
        caption: "Salon",
      },
    ],
    ...overrides,
  };
}

export function envelope(path: string, data: unknown, message = "Getirildi.") {
  return {
    success: true,
    message,
    httpStatus: "200 OK",
    path,
    requestId: "rid-detail",
    timeStamp: "2026-09-14T08:00:00.000000000Z",
    data,
  };
}

export function pageEnvelope(path: string, content: unknown[]) {
  return envelope(path, {
    content,
    page: 0,
    size: 20,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
    first: true,
    last: true,
  });
}

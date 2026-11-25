# Examiner Firestore Security Specification

## Data Invariants
1. `/users/{userId}` stores private user preferences, PII (`email`), wallpaper, avatar, theme, language, and bounded saved music tracks (`<= 100`). Only the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`) may read, create, update, or delete their document.
2. `/users/{userId}/exams/{examId}` and `/users/{userId}/lessons/{lessonId}` are owner-private subcollections gated on the parent `/users/{userId}` document (`get(.../users/$(userId)).data.ownerId == request.auth.uid`).
3. `ownerId` and `createdAt` are immutable across all updates. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
4. All document IDs (`userId`, `examId`, `lessonId`) match `^[a-zA-Z0-9_\-]+$` with length `1..128`.
5. No blanket `isSignedIn()` reads or list queries without `resource.data.ownerId == request.auth.uid`.

## Adversarial Test Cases ("Dirty Dozen")
1. Unauthenticated read/write to `/users/uid1` -> DENIED.
2. Unverified email (`email_verified == false`) write to `/users/uid1` -> DENIED.
3. Cross-user PII read (`auth.uid = uid2` GET `/users/uid1`) -> DENIED.
4. Shadow/ghost field injection (`isAdmin: true`) on `/users/uid1` create -> DENIED (`hasOnly`).
5. Identity spoofing (`ownerId: 'uid2'` when `auth.uid == 'uid1'`) -> DENIED.
6. Client-forged `createdAt` or `updatedAt` != `request.time` -> DENIED.
7. Mutating immutable `createdAt` or `ownerId` during update -> DENIED.
8. Oversized ID (`'a'.repeat(200)`) or invalid characters in `examId` -> DENIED (`isValidId`).
9. Orphaned exam write when `/users/{userId}` parent does not exist -> DENIED (`get()` parent check).
10. Unbounded array (`topics.length > 50` or `savedMusic.length > 100`) -> DENIED.
11. Wrong element type inside array (`topics: [123]`) -> DENIED (`topics[0] is string`).
12. Cross-user list query without matching `ownerId` -> DENIED (`resource.data.ownerId == request.auth.uid`).

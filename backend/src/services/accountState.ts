export const ACCOUNT_STATE_UNAVAILABLE = 'Account status is temporarily unavailable. Please retry.';
export const ACCOUNT_SCHEMA_REQUIRED = 'Account setup is incomplete. Contact the administrator to apply or reconcile account-status migration 029.';

export function accountStateError(schemaRequired = false) {
  return Object.assign(new Error(schemaRequired ? ACCOUNT_SCHEMA_REQUIRED : ACCOUNT_STATE_UNAVAILABLE), {
    statusCode: 503,
    code: schemaRequired ? 'AUTH_SCHEMA_REQUIRED' : 'AUTH_STATE_UNAVAILABLE',
  });
}

// Only classify the named column, never every undefined-column error.
export function isAccountSchemaError(error: { code?: string; message?: string } | null | undefined) {
  return (error?.code === '42703' || error?.code === 'PGRST204')
    && /\bis_suspended\b/i.test(error.message || '');
}

export function assertActiveAccount(user: { is_suspended?: unknown }) {
  if (typeof user.is_suspended !== 'boolean') throw accountStateError(true);
  if (user.is_suspended) throw Object.assign(
    new Error('This account has been suspended. Please contact support.'),
    { statusCode: 403, code: 'ACCOUNT_SUSPENDED' },
  );
}

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { trimAccountsToLimit } from '@/lib/telegram-account-link';
import { createClient } from '@/lib/telegram';
import { Api } from 'telegram';
import { cancelAllJobs, userKeyFromSession } from '@/lib/forward-registry';

// Helper to check admin password
function checkAdminAuth(request: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const providedPassword = request.headers.get('x-admin-password');
  
  if (!adminPassword || providedPassword !== adminPassword) {
    return false;
  }
  return true;
}

// GET codes (paginated, with optional search across code/first_name/last_name/phone_number)
export async function GET(request: Request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // Strip PostgREST `or()` separators so user input can't break the filter syntax.
  const q = (searchParams.get('q') ?? '').trim().replace(/[,()*]/g, '');

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20));

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('access_codes')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (q) {
    const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
    query = query.or(
      `code.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,phone_number.ilike.%${escaped}%`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const codesWithCounts = [];
  if (data && data.length > 0) {
    const codesList = data.map((c) => c.code);
    const { data: accountsData } = await supabase
      .from('telegram_accounts')
      .select('telegram_id, phone, first_name, last_name, username, access_code')
      .in('access_code', codesList);

    const accountsMap: Record<string, any[]> = {};
    for (const code of codesList) {
      accountsMap[code] = [];
    }
    if (accountsData) {
      for (const row of accountsData) {
        if (row.access_code) {
          accountsMap[row.access_code].push({
            telegram_id: row.telegram_id,
            phone: row.phone,
            first_name: row.first_name,
            last_name: row.last_name,
            username: row.username,
          });
        }
      }
    }

    for (const c of data) {
      codesWithCounts.push({
        ...c,
        linked_accounts_count: accountsMap[c.code]?.length ?? 0,
        linked_accounts: accountsMap[c.code] ?? [],
      });
    }
  }

  return NextResponse.json({
    data: codesWithCounts,
    total: count ?? 0,
    page,
    pageSize,
  });
}

// POST a new random code
export async function POST(request: Request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : '';
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : '';
  const phoneNumber = typeof body.phone_number === 'string' ? body.phone_number.trim() : '';
  const customCode = typeof body.code === 'string' ? body.code.trim() : '';

  // Optional cap on how many Telegram accounts this code may link. Null /
  // missing / non-positive is treated as unlimited.
  let accountLimit: number | null = null;
  if (body.account_limit != null && body.account_limit !== '') {
    const n = Number(body.account_limit);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return NextResponse.json(
        { error: 'account_limit must be a positive integer' },
        { status: 400 },
      );
    }
    accountLimit = n;
  }

  if (!phoneNumber) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
  }

  let finalCode = '';
  if (customCode) {
    const sanitized = customCode.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
    if (!sanitized) {
      return NextResponse.json({ error: 'Custom code contains invalid characters' }, { status: 400 });
    }
    finalCode = `VIP-${sanitized}`;
  } else {
    // Generate a random 8-character code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomCode = '';
    for (let i = 0; i < 8; i++) {
      randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    finalCode = `VIP-${randomCode}`;
  }

  // Check if code already exists to show a clean error message
  const { data: existingCode } = await supabase
    .from('access_codes')
    .select('code')
    .eq('code', finalCode)
    .maybeSingle();

  if (existingCode) {
    return NextResponse.json(
      { error: `Access code "${finalCode}" already exists.` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('access_codes')
    .insert([{
      code: finalCode,
      is_active: true,
      first_name: firstName || null,
      last_name: lastName || null,
      phone_number: phoneNumber,
      account_limit: accountLimit,
    }])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...data, linked_accounts_count: 0 });
}

// PATCH to update status and/or user details
export async function PATCH(request: Request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, is_active, first_name, last_name, phone_number, account_limit } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (typeof is_active === 'boolean') {
      updates.is_active = is_active;
    }

    if (first_name !== undefined) {
      const trimmed = typeof first_name === 'string' ? first_name.trim() : '';
      updates.first_name = trimmed || null;
    }

    if (last_name !== undefined) {
      const trimmed = typeof last_name === 'string' ? last_name.trim() : '';
      updates.last_name = trimmed || null;
    }

    if (phone_number !== undefined) {
      const trimmed = typeof phone_number === 'string' ? phone_number.trim() : '';
      if (!trimmed) {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
      }
      updates.phone_number = trimmed;
    }

    if (account_limit !== undefined) {
      // null / empty string clears the cap (back to unlimited).
      if (account_limit === null || account_limit === '') {
        updates.account_limit = null;
      } else {
        const n = Number(account_limit);
        if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
          return NextResponse.json(
            { error: 'account_limit must be a positive integer' },
            { status: 400 },
          );
        }
        updates.account_limit = n;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('access_codes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If the admin lowered (or set) the cap, immediately delete the oldest
    // excess telegram_accounts rows so the limit takes effect now instead of
    // waiting for someone to sign out manually. No-op when the count is
    // already within bounds or when account_limit was cleared.
    let trimmed = 0;
    if (
      account_limit !== undefined &&
      data &&
      typeof data.account_limit === 'number' &&
      typeof data.code === 'string'
    ) {
      trimmed = await trimAccountsToLimit(data.code, data.account_limit);
    }

    const { count: currentCount } = await supabase
      .from('telegram_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('access_code', data.code);

    return NextResponse.json({
      ...data,
      trimmed,
      linked_accounts_count: currentCount ?? 0,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// DELETE — fully remove an access code AND every linked Telegram account.
// For each linked account we cancel in-flight forwards and call auth.LogOut
// so the Telegram session can't be reused, then the FK cascade deletes the
// telegram_accounts rows along with the access_codes row.
//
// Accepts `id` in either the query string (?id=…) or JSON body — admins
// hitting it from a form-style request can use either.
export async function DELETE(request: Request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let id: string | number | null = null;
  const urlId = new URL(request.url).searchParams.get('id');
  if (urlId) id = urlId;
  if (!id) {
    try {
      const body = await request.json();
      id = body?.id ?? null;
    } catch {
      // body may be empty — that's fine, we'll error below
    }
  }
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // Resolve the code string so we can find linked telegram_accounts rows.
  const { data: codeRow, error: codeErr } = await supabase
    .from('access_codes')
    .select('code')
    .eq('id', id)
    .single();

  if (codeErr || !codeRow) {
    return NextResponse.json(
      { error: 'Access code not found' },
      { status: 404 },
    );
  }

  // Pull the linked telegram_accounts so we can clean up their Telegram
  // sessions before the cascade delete drops the rows.
  const { data: linked } = await supabase
    .from('telegram_accounts')
    .select('session')
    .eq('access_code', codeRow.code);

  // Log out each session in parallel — best effort, never blocks the
  // delete on Telegram-side failures.
  if (linked && linked.length > 0) {
    await Promise.all(
      linked.map(async (row: { session?: string | null }) => {
        const sessionString = row.session ?? '';
        if (!sessionString) return;
        try {
          cancelAllJobs(userKeyFromSession(sessionString));
        } catch {
          // forward-registry hiccup — proceed
        }
        try {
          const client = createClient(sessionString);
          await client.connect();
          try {
            await client.invoke(new Api.auth.LogOut());
          } catch {
            // session already dead / rejected LogOut — proceed
          }
          try {
            await client.disconnect();
          } catch {
            // ignore
          }
        } catch {
          // couldn't even connect — proceed with the DB delete
        }
      }),
    );
  }

  // Drop the access code. The FK cascade defined in the
  // telegram_accounts migration removes the link rows automatically; if
  // you didn't set ON DELETE CASCADE, run the explicit delete first.
  const { error: deleteErr } = await supabase
    .from('access_codes')
    .delete()
    .eq('id', id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    removedAccounts: linked?.length ?? 0,
  });
}

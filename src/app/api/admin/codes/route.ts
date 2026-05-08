import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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

  return NextResponse.json({
    data: data ?? [],
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

  if (!phoneNumber) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
  }

  // Generate a random 8-character code
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomCode = '';
  for (let i = 0; i < 8; i++) {
    randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const { data, error } = await supabase
    .from('access_codes')
    .insert([{
      code: `VIP-${randomCode}`,
      is_active: true,
      first_name: firstName || null,
      last_name: lastName || null,
      phone_number: phoneNumber,
    }])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PATCH to update status and/or user details
export async function PATCH(request: Request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, is_active, first_name, last_name, phone_number } = body;

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

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  return [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h]
        const s = v === null || v === undefined ? '' : String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ),
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Password check
  const pw = req.headers.get('x-admin-password')
  if (!pw || pw !== Deno.env.get('ADMIN_PASSWORD')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { action, ...params } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    if (action === 'getMembers') {
      const { data } = await supabase
        .from('members').select('*').order('registered_at', { ascending: false })
      return new Response(JSON.stringify({ members: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'getBookings') {
      const { data } = await supabase
        .from('bookings').select('*').order('created_at', { ascending: false })
      return new Response(JSON.stringify({ bookings: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'updateMember') {
      const { phone, ...updates } = params
      await supabase.from('members').update(updates).eq('phone', phone)
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'updateBooking') {
      const { id, ...updates } = params
      await supabase.from('bookings').update(updates).eq('id', id)
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'exportCSV') {
      const table = params.type === 'members' ? 'members' : 'bookings'
      const orderCol = table === 'bookings' ? 'created_at' : 'registered_at'
      const { data } = await supabase
        .from(table).select('*').order(orderCol, { ascending: false })
      return new Response(toCSV(data || []), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${table}.csv"`,
        },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ref, fileData, fileName, mimeType } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Decode base64 → binary
    const binary = Uint8Array.from(atob(fileData), c => c.charCodeAt(0))
    const path = `${ref}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(path, binary, { contentType: mimeType, upsert: true })

    if (uploadError) {
      return new Response(JSON.stringify({ success: false, error: uploadError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { publicUrl } } = supabase.storage
      .from('payment-proofs')
      .getPublicUrl(path)

    await supabase
      .from('bookings')
      .update({ status: 'Payment Submitted', proof_url: publicUrl })
      .eq('ref', ref)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

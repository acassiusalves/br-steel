
// app/api/callback/bling/route.ts
import { NextResponse } from 'next/server';
import { saveBlingCredentials } from '@/app/actions';

// This function should not need to read from Firestore.
// It receives client ID and secret from the environment.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // You should validate this state against a stored value

  if (!code) {
    return NextResponse.json({ error: 'Nenhum código de autorização recebido.' }, { status: 400 });
  }

  // Client ID and Secret MUST come from environment variables on the server.
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Credenciais do Bling (Client ID/Secret) não configuradas nas variáveis de ambiente do servidor.");
    return NextResponse.json({ error: 'Credenciais do Bling não configuradas no servidor.' }, { status: 500 });
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const tokenResponse = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
        'Accept': '1.0'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
      }),
      cache: "no-store",
    });

    const tokenData = await tokenResponse.json();

    if (tokenResponse.ok) {
      // Save only the tokens and expiration securely in Firestore
      await saveBlingCredentials({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (Number(tokenData.expires_in) * 1000),
      });

      return new NextResponse(`
        <html>
          <head>
            <title>Conexão com Bling</title>
            <meta charset="UTF-8">
            <style>
              body { 
                font-family: sans-serif; 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                height: 100vh; 
                background-color: #f0f2f5; 
              }
              .container { 
                text-align: center; 
                padding: 40px;
                border-radius: 8px;
                background-color: white;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              }
              h1 { color: #1877f2; }
              p { color: #333; }
              a {
                display: inline-block;
                margin-top: 20px;
                padding: 10px 20px;
                background-color: #1877f2;
                color: white;
                text-decoration: none;
                border-radius: 5px;
              }
            </style>
             <script>
              setTimeout(() => {
                window.location.href = "/api";
              }, 2000);
            </script>
          </head>
          <body>
            <div class="container">
              <h1>Sucesso!</h1>
              <p>Sua conta Bling foi conectada. Você será redirecionado em instantes.</p>
              <a href="/api">Voltar para o painel</a>
            </div>
          </body>
        </html>
      `, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } else {
        const errorDescription = tokenData.error_description || tokenData.error?.description || 'Falha ao obter tokens do Bling';
        throw new Error(errorDescription);
    }

  } catch (error: any) {
     return new NextResponse(`
        <html>
          <head>
            <title>Erro na Conexão com Bling</title>
            <meta charset="UTF-8">
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f0f2f5; }
              .container { text-align: center; padding: 40px; border-radius: 8px; background-color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              h1 { color: #d93025; }
              p { color: #333; }
              code { background-color: #eee; padding: 3px 6px; border-radius: 4px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Erro na Conexão</h1>
              <p>Não foi possível obter os tokens de acesso do Bling.</p>
              <p>Detalhes: <code>${error.message}</code></p>
              <p><a href="/api">Tentar novamente</a></p>
            </div>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 500
      });
  }
}
    


    

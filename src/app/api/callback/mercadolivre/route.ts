// app/api/callback/mercadolivre/route.ts
import { NextResponse } from 'next/server';
import { saveMercadoLivreCredentials } from '@/app/actions';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  console.log('🔐 [MERCADO LIVRE CALLBACK] URL completa:', request.url);
  console.log('🔐 [MERCADO LIVRE CALLBACK] code:', code);
  console.log('🔐 [MERCADO LIVRE CALLBACK] error:', error);

  // Se o Mercado Livre retornou um erro
  if (error) {
    return NextResponse.json({
      error: 'Autorização negada pelo Mercado Livre',
      details: errorDescription || error
    }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({
      error: 'Nenhum código de autorização recebido.',
      hint: 'Verifique se você autorizou o aplicativo no Mercado Livre.'
    }, { status: 400 });
  }

  // Busca credenciais do Firestore (salvas pela interface de configurações)
  let appId = process.env.MERCADOLIVRE_APP_ID;
  let clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
  let redirectUri = process.env.MERCADOLIVRE_REDIRECT_URI;

  if (!appId || !clientSecret) {
    try {
      const credentialsDocRef = doc(db, 'appConfig', 'mercadoLivreCredentials');
      const docSnap = await getDoc(credentialsDocRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        appId = appId || data.appId;
        clientSecret = clientSecret || data.clientSecret;
      }
    } catch (e) {
      console.error('Erro ao buscar credenciais do Firestore:', e);
    }
  }

  if (!redirectUri) {
    redirectUri = `${origin}/api/callback/mercadolivre`;
  }

  if (!appId || !clientSecret) {
    console.error("Credenciais do Mercado Livre não encontradas no servidor nem no Firestore.");
    return NextResponse.json({ error: 'Credenciais do Mercado Livre não configuradas. Salve o App ID e Client Secret na página de Conexão API.' }, { status: 500 });
  }

  try {
    const tokenResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });

    const tokenData = await tokenResponse.json();

    if (tokenResponse.ok) {
      // Save tokens securely in Firestore
      await saveMercadoLivreCredentials({
        appId: appId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (Number(tokenData.expires_in) * 1000),
        userId: tokenData.user_id?.toString(),
      });

      return new NextResponse(`
        <html>
          <head>
            <title>Conexão com Mercado Livre</title>
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
              h1 { color: #FFE600; text-shadow: 1px 1px 2px #000; }
              p { color: #333; }
              a {
                display: inline-block;
                margin-top: 20px;
                padding: 10px 20px;
                background-color: #FFE600;
                color: #333;
                text-decoration: none;
                border-radius: 5px;
                font-weight: bold;
              }
            </style>
             <script>
              setTimeout(() => {
                window.location.href = "/api-settings";
              }, 2000);
            </script>
          </head>
          <body>
            <div class="container">
              <h1>Sucesso!</h1>
              <p>Sua conta Mercado Livre foi conectada. Você será redirecionado em instantes.</p>
              <a href="/api-settings">Voltar para o painel</a>
            </div>
          </body>
        </html>
      `, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } else {
        const errorMsg = tokenData.message || tokenData.error || 'Falha ao obter tokens do Mercado Livre';
        throw new Error(errorMsg);
    }

  } catch (error: any) {
     return new NextResponse(`
        <html>
          <head>
            <title>Erro na Conexão com Mercado Livre</title>
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
              <p>Não foi possível obter os tokens de acesso do Mercado Livre.</p>
              <p>Detalhes: <code>${error.message}</code></p>
              <p><a href="/api-settings">Tentar novamente</a></p>
            </div>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 500
      });
  }
}

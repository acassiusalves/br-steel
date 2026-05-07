// app/api/callback/mercadolivre/route.ts
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  saveMlCredentialsAdmin,
  setPrimaryMlAccountIdAdmin,
  getPrimaryMlAccountIdAdmin,
} from '@/services/firestore-admin';
import { consumeMlOAuthState } from '@/app/actions';
import type { MercadoLivreCredentials } from '@/lib/types';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  console.log('🔐 [MERCADO LIVRE CALLBACK] URL completa:', request.url);
  console.log('🔐 [MERCADO LIVRE CALLBACK] code:', code);
  console.log('🔐 [MERCADO LIVRE CALLBACK] state:', state);
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

  // Validação do `state` (CSRF) e recuperação do `code_verifier` (PKCE).
  // Se a UI iniciou o fluxo via `startMlOAuth`, o state existe no Firestore.
  if (!state) {
    return NextResponse.json({
      error: 'Parâmetro state ausente. Por motivos de segurança, inicie o fluxo pela página de Conexão API.',
    }, { status: 400 });
  }

  const pendingState = await consumeMlOAuthState(state);
  if (!pendingState) {
    return NextResponse.json({
      error: 'State inválido, expirado ou já utilizado. Por motivos de segurança, inicie o fluxo novamente.',
    }, { status: 400 });
  }

  // Resolve credenciais (env > conta primária no Firestore). O appId já vem
  // pinado no state — usamos como verificação cruzada.
  let appId: string | undefined = process.env.MERCADOLIVRE_APP_ID || pendingState.appId;
  let clientSecret: string | undefined = process.env.MERCADOLIVRE_CLIENT_SECRET;
  // redirect_uri DEVE bater com o que foi enviado no authorize. Usa o que está
  // pinado no state (gerado pela mesma resolveMlRedirectUri da action).
  const redirectUri = pendingState.redirectUri;

  if (!clientSecret) {
    // 1. Tenta a conta primária
    try {
      const primaryId = await getPrimaryMlAccountIdAdmin();
      const docSnap = await adminDb.collection('mercadoLivreAccounts').doc(primaryId).get();
      if (docSnap.exists) {
        const data = docSnap.data() as MercadoLivreCredentials;
        appId = appId || data.appId || data.clientId;
        clientSecret = clientSecret || data.clientSecret;
      }
    } catch (e) {
      console.error('Erro ao buscar credenciais primárias:', e);
    }
  }

  // 2. Tenta o doc legado
  if (!clientSecret) {
    try {
      const legacy = await adminDb.collection('appConfig').doc('mercadoLivreCredentials').get();
      if (legacy.exists) {
        const data = legacy.data() as MercadoLivreCredentials;
        appId = appId || data.appId || data.clientId;
        clientSecret = clientSecret || data.clientSecret;
      }
    } catch (e) {
      console.error('Erro ao buscar credenciais legadas:', e);
    }
  }

  // 3. Tenta qualquer conta com secret
  if (!clientSecret) {
    try {
      const snap = await adminDb.collection('mercadoLivreAccounts').limit(10).get();
      for (const d of snap.docs) {
        const data = d.data() as MercadoLivreCredentials;
        if (data.clientSecret) {
          appId = appId || data.appId || data.clientId;
          clientSecret = data.clientSecret;
          break;
        }
      }
    } catch (e) {
      console.error('Erro varrendo contas:', e);
    }
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
        code_verifier: pendingState.codeVerifier,
      }),
      cache: "no-store",
    });

    const tokenData = await tokenResponse.json();

    if (tokenResponse.ok) {
      // Identificador da conta = user_id do ML quando disponível.
      // Fallback para a conta primária atual ou 'primary' se ainda não houver nenhuma.
      const userId = tokenData.user_id?.toString();
      const primaryId = await getPrimaryMlAccountIdAdmin().catch(() => 'primary');
      const accountId = userId || primaryId || 'primary';

      const payload: Partial<MercadoLivreCredentials> = {
        appId: appId,
        clientSecret: clientSecret,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (Number(tokenData.expires_in) * 1000),
        scope: tokenData.scope,
        userId: userId,
        lastRefreshedAt: Date.now(),
      };

      await saveMlCredentialsAdmin(accountId, payload);

      // Se ainda não havia conta primária definida, define esta como primária.
      try {
        const currentPrimaryDoc = await adminDb.collection('appConfig').doc('mlPrimaryAccount').get();
        if (!currentPrimaryDoc.exists) {
          await setPrimaryMlAccountIdAdmin(accountId);
        }
      } catch (e) {
        console.warn('Não foi possível definir conta primária:', e);
      }

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

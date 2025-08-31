// app/api/callback/bling/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // TODO: Validar o 'state' e trocar o 'code' pelo access_token
  
  if (code) {
    // Apenas para demonstração, vamos retornar uma página de sucesso.
    // O ideal aqui seria trocar o código pelo token e redirecionar para o painel.
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
            code { 
                background-color: #eee;
                padding: 3px 6px;
                border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Sucesso!</h1>
            <p>Sua conta Bling foi conectada com sucesso.</p>
            <p>Código recebido: <code>${code}</code></p>
            <p><a href="/">Voltar para o painel</a></p>
          </div>
        </body>
      </html>
    `, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }

  return NextResponse.json({ error: 'Nenhum código de autorização recebido.' }, { status: 400 });
}

# Configuração Local - BR Steel

## Status da Instalação
✅ Dependências instaladas
✅ Arquivo .env.local criado

## Configurações Necessárias para Rodar Localmente

### 1. Variáveis de Ambiente

O arquivo `.env.local` foi criado. Você precisa:

#### **OBRIGATÓRIO - Google AI API Key**
O sistema usa Genkit com Google AI (Gemini). Para obter a chave:

1. Acesse: https://aistudio.google.com/app/apikey
2. Crie uma API key
3. Edite `.env.local` e substitua `sua-chave-api-aqui` pela chave real

```bash
GOOGLE_GENAI_API_KEY=sua-chave-real-aqui
```

#### **OPCIONAL - Integração Bling**
Se for usar a integração com Bling ERP:
- Configure `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` e `BLING_REDIRECT_URI`

### 2. Firebase

O projeto já está configurado para usar o Firebase do projeto `marketflow-9h4tg`.

**Credenciais Firebase** (já configuradas em [src/lib/firebase.ts](src/lib/firebase.ts:8-16)):
- Project ID: marketflow-9h4tg
- As credenciais estão hardcoded no código

**⚠️ IMPORTANTE:** Para produção, mova essas credenciais para variáveis de ambiente.

#### Índices do Firestore
Para melhor performance, crie os índices necessários:

```bash
firebase deploy --only firestore:indexes
```

Ou siga as instruções em [FIRESTORE_INDEX_INSTRUCTIONS.md](FIRESTORE_INDEX_INSTRUCTIONS.md)

### 3. Rodar o Projeto

#### Modo Desenvolvimento (porta 9003)
```bash
npm run dev
```

Acesse: http://localhost:9003

#### Genkit (AI) - Modo Dev
```bash
npm run genkit:dev
```

#### Genkit com Watch
```bash
npm run genkit:watch
```

#### Build de Produção
```bash
npm run build
npm start
```

### 4. Estrutura do Sistema

#### Páginas Principais:
- **/login** - Autenticação
- **/perfil** - Perfil e permissões do usuário
- **/vendas** - Dashboard de vendas
- **/producao** - Gestão de produção
- **/estoque** - Controle de estoque
- **/insumos** - Gestão de insumos
- **/api** - Integrações API
- **/configuracoes** - Configurações do sistema

#### Tecnologias:
- **Frontend:** Next.js 15, React 18, Tailwind CSS
- **UI Components:** Radix UI, Shadcn/ui
- **Backend:** Firebase (Firestore)
- **IA:** Genkit com Google AI (Gemini 2.5 Flash)
- **Gráficos:** Recharts
- **Formulários:** React Hook Form + Zod

### 5. Problemas Conhecidos

#### Vulnerabilidades NPM
- 20 vulnerabilidades detectadas (3 low, 13 moderate, 4 high)
- Para corrigir: `npm audit fix` (sem breaking changes)
- Para forçar correção: `npm audit fix --force` (pode quebrar)

#### TypeScript/ESLint
O build ignora erros de TypeScript e ESLint ([next.config.ts](next.config.ts:5-10))
- `typescript.ignoreBuildErrors: true`
- `eslint.ignoreDuringBuilds: true`

**Recomendação:** Habilite essas verificações gradualmente para melhor qualidade do código.

### 6. Segurança

⚠️ **ATENÇÃO:** As credenciais do Firebase estão expostas no código fonte!

**Recomendações:**
1. Mova as credenciais Firebase para `.env.local`
2. Use Firebase App Check para proteger APIs
3. Configure regras de segurança no Firestore
4. Não commite arquivos `.env.local` no Git (já está no .gitignore)

### 7. Comandos Úteis

```bash
# Desenvolvimento
npm run dev              # Inicia servidor dev na porta 9003

# Build e produção
npm run build            # Cria build otimizado
npm start                # Inicia servidor de produção

# Qualidade de código
npm run lint             # Executa ESLint
npm run typecheck        # Verifica tipos TypeScript

# IA/Genkit
npm run genkit:dev       # Inicia Genkit dev
npm run genkit:watch     # Genkit com hot reload
```

### 8. Próximos Passos Recomendados

1. ✅ Obter API Key do Google AI e configurar no `.env.local`
2. Testar o sistema rodando `npm run dev`
3. Verificar se consegue acessar http://localhost:9003
4. Testar login e autenticação
5. Criar índices do Firestore para melhor performance
6. Considerar migrar credenciais Firebase para variáveis de ambiente
7. Resolver vulnerabilidades do npm
8. Habilitar verificações de TypeScript/ESLint gradualmente

## Suporte

Para problemas ou dúvidas:
- Verifique os logs do console do navegador
- Verifique os logs do terminal onde rodou `npm run dev`
- Confirme que o Firebase está acessível
- Confirme que a API Key do Google AI está configurada corretamente

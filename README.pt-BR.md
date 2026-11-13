# MD Viewer

Um visualizador de Markdown rápido e nativo para macOS. Feito com Tauri 2 (Rust + WKWebView), TypeScript e um frontend sem framework.

[English](README.md)

> Status: pré-1.0 (`0.1.x`). Os builds **não são assinados** e são só para Macs com **Apple Silicon** (detalhes abaixo).

## Recursos

- **GFM** — tabelas, listas de tarefas, tachado, links automáticos
- **Realce de sintaxe** com highlight.js (tema GitHub Dark)
- **Matemática com KaTeX** — `$inline$` e `$$bloco$$`
- **Diagramas Mermaid** — blocos ` ```mermaid ` são renderizados sob demanda
- **Frontmatter YAML** — exibido como um bloco de metadados no topo, com chips para `tags`/`aliases`
- **Imagens com caminho relativo** — resolvidas a partir da pasta do arquivo
- **Tema** — claro, escuro ou seguindo o sistema
- **Cmd+F** — busca no arquivo com contador, n/N para navegar, Esc para fechar
- **Cmd+O** — abre um arquivo em uma nova janela
- **Cmd+P** — paleta de arquivos recentes com busca aproximada
- **Cmd+\\** — alterna o sumário flutuante
- **Cmd+,** — configurações (pasta do vault, tema)
- **Cmd+S** — adiciona o arquivo atual ao seu vault do Obsidian
- **Cmd+Shift+P** — imprimir / exportar para PDF
- **Cmd+Shift+R** — mostrar no Finder
- **Recarga automática** — observa o arquivo aberto e atualiza quando ele muda fora do app
- **Uma janela por arquivo** — cada arquivo Markdown abre na própria janela (como TextEdit/Pré-visualização)
- **Associação de arquivos** — pode ser o app padrão para `.md` no Finder

## Instalação

1. Baixe `MD Viewer_<versão>_aarch64.dmg` na página de [Releases](../../releases).
2. Abra o DMG e arraste o **MD Viewer** para `/Applications`.
3. **Primeira abertura (app sem assinatura).** O app não é assinado com Apple Developer ID nem notarizado, então o Gatekeeper do macOS o bloqueia na primeira vez. Escolha um caminho:
   - **Ajustes do Sistema → Privacidade e Segurança** → role até o aviso sobre o "MD Viewer" → **Abrir Mesmo Assim** (caminho que funciona no macOS 15 ou superior).
   - **Clique com o botão direito** no app → **Abrir** → **Abrir** (macOS 14 ou anterior; no macOS 15+ o diálogo não oferece mais essa opção).
   - Ou remova a marca de quarentena uma vez pelo Terminal:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/MD Viewer.app"
     ```
4. Associe os arquivos `.md` ao MD Viewer:
   - No Finder, selecione qualquer `.md` → **Obter Informações** (`Cmd+I`).
   - Em **Abrir com**, escolha **MD Viewer**.
   - Clique em **Alterar Tudo…** → confirme.

**Requisitos:** macOS 11 ou superior. O DMG publicado é só para **Apple Silicon (arm64)**. Em um Mac Intel, compile a partir do código-fonte (abaixo).

## Segurança e privacidade

- HTML bruto dentro do Markdown **não** é renderizado (aparece como texto). O frontmatter é escapado. O Mermaid roda em modo `strict`.
- Há uma Content-Security-Policy. **Imagens remotas (`http(s)://…`) são bloqueadas**, para que abrir um arquivo não confiável não avise nenhum servidor de rastreamento. Carregam: arquivos ao lado do documento (caminhos relativos), URLs `data:` e `blob:`.
- Imagens locais passam pelo protocolo de assets do Tauri, limitado à pasta do arquivo aberto e suas subpastas. Um arquivo direto na pasta pessoal expõe só os vizinhos diretos, não a pasta pessoal inteira.
- Links no documento nunca navegam a janela do app: `http(s)` e `mailto:` abrem no navegador ou cliente de e-mail padrão, links relativos para `.md` abrem em uma nova janela do MD Viewer, `#âncoras` rolam a página, e todo o resto (`javascript:`, `file:`, `data:`, …) é ignorado.
- Sem telemetria, e o app não faz requisições de rede por conta própria.

## Adicionar ao Vault (integração com o Obsidian)

- Clique em **Add to Vault** (ou `Cmd+S`).
- Na primeira vez, o app pede a pasta do seu vault do Obsidian. A escolha fica salva.
- O arquivo atual é **copiado** para a pasta do vault.
  - Se já existir um arquivo com o mesmo nome, escolha **Replace** (substituir) ou **Keep both** (manter os dois, com timestamp no nome novo).
- Um aviso confirma, com a ação **Reveal in Finder**.

Dá para trocar a pasta depois em **Configurações** (`Cmd+,`).

## Compilar a partir do código-fonte

Requisitos: macOS, [Rust](https://rustup.rs) (stable), Node.js 22+, [pnpm](https://pnpm.io) 11, Xcode Command Line Tools.

```bash
git clone https://github.com/pedroberaldo87/MY-MD-VIEWER.git
cd MY-MD-VIEWER
pnpm install --frozen-lockfile
pnpm tauri build --bundles dmg   # -> src-tauri/target/release/bundle/dmg/
```

O resultado segue a arquitetura do seu Mac (arm64 no Apple Silicon, x86_64 no Intel). O `.app` fica em `src-tauri/target/release/bundle/macos/`.

## Desenvolvimento

```bash
# instalar dependências JS
pnpm install

# modo dev com hot reload
pnpm tauri dev

# checagem de tipos e testes unitários
pnpm typecheck
pnpm test

# build de produção (.app + .dmg)
pnpm tauri build

# regenerar os ícones a partir de src-tauri/icons/source.png
pnpm tauri icon src-tauri/icons/source.png
```

A pilha e a estrutura de pastas estão descritas no [README em inglês](README.md#development).

## Releases (mantenedores)

O CI compila a cada push e PR para `main` (`.github/workflows/build.yml`). Enviar uma tag `vX.Y.Z` igual à versão de `src-tauri/tauri.conf.json` dispara `.github/workflows/release.yml`, que compila o DMG sem assinatura e o anexa a um **rascunho** de GitHub Release. A revisão e a publicação são manuais.

## Licença

[MIT](LICENSE)

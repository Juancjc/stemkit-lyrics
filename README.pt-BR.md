# StemKit

*[Read in English](README.md)*

Separe qualquer música do YouTube em stems isolados — **vocais, bateria, baixo, guitarra, piano** e mais — direto na sua máquina.

Busque no YouTube ou cole um link, escolha os instrumentos que quiser, e toque o resultado como um mini DAW: o vídeo de um lado, cada stem no seu próprio fader, tudo perfeitamente sincronizado. Karaokê, acapellas e instrumentais a um clique de distância.

Tudo roda localmente — sem contas, sem chaves de API. Suas músicas, buscas e áudio nunca saem da sua máquina. O app envia um único ping anônimo e minúsculo por instalação (um id de instalação aleatório + versão/SO) para que eu possa contar quantas pessoas usam o app — veja [Privacidade](#privacidade) para detalhes.

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-black) ![local](https://img.shields.io/badge/100%25-local-emerald)

<p align="center">
  <img src="docs/stemkit.png" alt="StemKit separando Bohemian Rhapsody do Queen em seis stems — player de vídeo, presets e faixas de waveform coloridas por instrumento" width="100%" />
</p>

## Recursos

- Busca de YouTube embutida, ou cole um link
- Escolha os instrumentos individualmente; a engine de separação certa é escolhida pra você
- Sincronia justa entre áudio e vídeo, com seek instantâneo e sem artefatos
- Presets de um clique: **Todos · Karaokê · Acapella · Bateria + Baixo**
- Mute/solo/volume por stem, waveforms com clique-para-buscar
- Separação em segundo plano em paralelo, com progresso ao vivo
- Exporte qualquer stem (ou todos) como WAV
- Totalmente offline depois da configuração inicial — a separação roda no Mac (MPS), GPUs NVIDIA (CUDA), GPUs AMD no Linux (ROCm, experimental) ou CPU; ffmpeg incluso

## Download

Pegue os instaladores em [Releases](https://github.com/danvelope/stemkit/releases):
- **macOS**: `StemKit-x.y.z-mac-arm64.dmg` (Apple Silicon) ou `StemKit-x.y.z-mac-x64.dmg` (Intel)
- **Windows**: `StemKit-Setup-x.y.z.exe` (instalador) ou `.zip` portátil
- **Linux** (x64): `StemKit-x.y.z-linux-x86_64.AppImage` (portátil, com auto-atualização) ou `StemKit-x.y.z-linux-amd64.deb`

A primeira execução cria um ambiente Python privado e baixa a engine de separação (~2 GB) — uma única vez. O ffmpeg já vem incluso — nada mais pra instalar.

Upgrades de qualidade opcionais ficam atrás de um ícone de engrenagem no app (Configurações), cada um com seu próprio download único:
- **Vocais de qualidade de estúdio** (Mel-Band Roformer): +913 MB — roda em GPU ou CPU (CPU é mais lento)
- **Demucs ajustado fino** (htdemucs_ft): +~320 MB, até 4× mais lento
- **Passes de refinamento**: 2 shifts em vez de 1, até 3× mais lento

> **Primeira execução no macOS**: os builds são assinados com um Developer ID mas não notarizados, então o macOS pode dizer que "não é possível verificar o desenvolvedor". Correção única: **Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim** (ou `xattr -cr /Applications/StemKit.app`).
>
> **Windows**: o SmartScreen pode avisar na primeira execução — "Mais informações → Executar assim mesmo".

## Requisitos

- **macOS 12+** (Apple Silicon ou Intel x86_64) ou **Windows 10/11** (x64) ou **Linux x64** (Ubuntu 22.04+ ou equivalente; driver NVIDIA pra separação em GPU, AMD via ROCm no Linux — experimental)
- Nenhuma instalação manual: se nenhum Python 3.9+ for detectado, o StemKit baixa um runtime privado (python-build-standalone) durante a configuração inicial
- Node.js 24+ apenas pra compilar a partir do código-fonte

> **Mac Intel**: o PyTorch não publica wheels macOS x86_64 além da 2.2.2, então a configuração inicial instala essa versão em vez da 2.5.1 usada em todo o resto. O MPS ainda fica disponível nesse build quando a máquina tem uma GPU compatível com Metal (verificado num Mac Intel com GPU dedicada); Macs só com GPU integrada caem pra CPU.

## Desenvolver

```bash
npm install
npm run dev
```

Versão errada do Node? Os scripts relançam sozinhos com uma versão adequada (nvm / nvm-windows).

## Build & release

```bash
bash scripts/fetch-ffmpeg.sh        # mac (compila ffmpeg arm64 + x86_64 + libsoxr, precisa de cmake) / linux (uma vez)
powershell scripts/fetch-ffmpeg.ps1 # windows (uma vez)

npm run dist        # mac dmg -> release/
npm run dist:win    # windows nsis+zip -> release/
npm run dist:linux  # linux AppImage+deb (x64) -> release/
npm run dist:all    # ambos (no SO correspondente)
```

> **Linux**: compilar o `.deb` precisa de `dpkg` + `fakeroot` na máquina; rodar o `.AppImage` precisa de FUSE. A auto-atualização dentro do app funciona no AppImage — instalações `.deb` atualizam baixando o pacote de novo.

Os releases são compilados pelo GitHub Actions:
- push de uma tag `v*` → binários anexados a um GitHub Release em rascunho
- `workflow_dispatch` ("Run workflow") → artefatos sob demanda na página da execução

Os builds de macOS são assinados com Developer ID quando o certificado está disponível — veja **Assinatura no CI** abaixo pra configuração única, mais notarização opcional.

### Assinatura no CI (configuração única)

Builds locais assinam automaticamente com o certificado do seu keychain. Os runners do CI têm keychains vazios, então passe o certificado via **secrets** do repositório:

1. Keychain Access → My Certificates → clique com o botão direito em `Developer ID Application: ...` → Export → `.p12` (defina uma senha de exportação)
2. Converta pra base64 e adicione estes secrets no repositório:
   - `CSC_MAC_P12` — a string base64: `base64 -i developer-id.p12 | pbcopy`
   - `CSC_MAC_PASSWORD` — a senha de exportação do passo 1
3. Opcional (notarização completa, zero avisos do Gatekeeper): adicione `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` **e** defina a variável de repositório `ENABLE_NOTARIZATION` como `true` (Settings → Secrets and variables → Actions → Variables). Exige uma assinatura **ativa** do Apple Developer — o serviço de notarização da Apple rejeita contas expiradas.

Sem esses secrets, o CI cai pra assinatura ad-hoc (o app roda, mas o Gatekeeper reclama no download).

## Como funciona

```
URL do YouTube ──► yt-dlp (+runtime JS) ──► ffmpeg incluso ──► mel-band roformer (vocais) ─┐
                                           │                                               ├─► stems/*.wav
                                           └─────────────► demucs htdemucs ────────────────┘
                                                (bateria/baixo/outros, com média de shifts)

Renderer do Electron ◄──── eventos IPC ─────┘
iframe de vídeo (mudo) + reprodução de stems via Web Audio · clock mestre = o próprio áudio
```

## Notas

- Baixar áudio do YouTube viola os Termos de Serviço deles pra produtos públicos — mantenha isso pessoal.
- Quer os dados em outro lugar (venv, models, songs, library)? Inicie o app com `STEMKIT_DATA_DIR=/caminho/para/pasta` definido. Sem a variável, usa a pasta padrão do app.
- O yt-dlp quebra de vez em quando quando o YouTube muda algo; o diálogo de erro oferece uma atualização de um clique (atualiza `yt-dlp` e o solucionador de desafios juntos).

## Privacidade

- **Nunca sai da sua máquina:** os vídeos que você baixa, as músicas que separa, sua biblioteca, suas buscas e seu áudio — nada disso é enviado pra lugar nenhum. Toda a separação roda localmente.
- **Contagem anônima de instalações:** na primeira vez que o app roda, ele envia um pequeno POST pra um Cloudflare Worker (`stemkit-stats.danielravina.workers.dev`) — uma vez por instalação, para sempre. Contém um **id de instalação aleatório** (gerado localmente, guardado na pasta de configurações do app), a versão do app, SO e arquitetura. Nenhum perfil baseado em IP é construído, sem cookies, sem identificadores ligados a você, sem SDKs de analytics. Se a primeira tentativa falhar (por exemplo, você está offline), ela simplesmente tenta de novo numa execução futura.
- **Pra que serve:** contar instalações e uso ativo (as mesmas estatísticas que você teria com downloads de releases do GitHub, menos o ruído de auto-atualização). O código do contador está em [`telemetry-worker/`](telemetry-worker) — inspecionável como o resto do app.
- **Builds totalmente offline:** se preferir não enviar nada, compile a partir do código-fonte e remova `src/main/telemetry.ts` (ou bloqueie o domínio do worker no seu firewall) — tudo mais funciona identicamente offline.

## Estrutura

```
src/main         Processo principal do Electron (pipeline, bootstrap do ambiente, biblioteca)
src/preload      Ponte IPC
src/renderer     UI em React (player, engine de sincronia, waveforms)
python/          separate.py (demucs) e roformer.py (vocais neurais) com saída de progresso em JSON
python/vendor/   código de modelos com patches — veja python/vendor/README.md
scripts/         runner node, downloaders de ffmpeg
build/           fontes dos ícones
```

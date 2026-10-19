# Lumen — czytnik dokumentów i książek

Aplikacja PWA (instalowana z ekranu startowego, działa offline) do czytania PDF, EPUB, DOCX, TXT, MD i HTML.
Rozpoznaje spis treści i rozdziały, pamięta miejsce, w którym skończyłeś, i prowadzi przez dokument rozdział po rozdziale.
Wszystkie pliki i postępy zostają w przeglądarce użytkownika (IndexedDB) — nic nie jest wysyłane na serwer.

## Publikacja na GitHub Pages

1. Utwórz nowe repozytorium na GitHubie (np. `lumen`).
2. Wgraj **zawartość folderu `lumen`** do głównego katalogu repozytorium (`index.html` ma być w korzeniu).
3. *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`*.
4. Po minucie aplikacja będzie pod `https://TWOJ-LOGIN.github.io/lumen/`.
5. Otwórz adres na telefonie i wybierz „Dodaj do ekranu głównego” (iOS: Safari → Udostępnij → Do ekranu początkowego; Android/Chrome: „Zainstaluj aplikację”).

Aplikacja używa wyłącznie ścieżek względnych, więc działa w podkatalogu repozytorium. Nie ma kroku budowania.

## Aktualizacje
Po zmianie plików zwiększ numer `VERSION` na początku `sw.js` (np. `lumen-v1.0.1`) — użytkownik zobaczy komunikat „Dostępna nowa wersja”.
Dodając nowy plik do aplikacji, dopisz go do listy `PRECACHE` w `sw.js`.

## Najważniejsze funkcje
- Rozpoznawanie rozdziałów (zakładki PDF, spis treści EPUB, nagłówki, a gdy ich brak — podział według długości).
- Rozdział jako sesja czytania (bez quizów i fiszek): otwarcie rozdziału, pasek postępu, ekran końca z przejściem do następnego.
- Pamięć pozycji co do akapitu, spis rozdziałów z terminem, seria dni i cel dzienny.
- Zakreślenia w 5 kolorach, notatki, zakładki, eksport do Markdown, wyszukiwanie w całym dokumencie.
- Czytanie na głos z podświetlaniem zdań, tryb skupienia, 5 motywów, 5 akcentów, 4 kroje pisma.
- Podgląd oryginalnej strony PDF dla diagramów i tabel; kopia zapasowa postępu (JSON).

## Skróty klawiaturowe
`[` `]` rozdziały · `T` spis treści · `N` notatki · `/` szukaj · `A` wygląd · `L` czytaj na głos · `F` skupienie · `B` zakładka · `Esc` zamknij

## Biblioteki zewnętrzne (w `vendor/`)
pdf.js (Apache-2.0), JSZip, mammoth.js. Czcionki: Inter, Literata, Fraunces, Atkinson Hyperlegible (SIL OFL).

# Sosac Modern WebView TV

Moderná Android / Android TV kostra pre `https://tv.sosac.tv/cs/`.

## Čo obsahuje v3

- čistý WebView klient bez IPTV častí
- fullscreen video cez `WebChromeClient.onShowCustomView`
- perzistentné cookies, aby ostalo prihlásenie zapamätané
- skryté login menu po 5 klikoch na logo `S`
- šifrované uloženie používateľa a hesla cez `EncryptedSharedPreferences`
- automatické otvorenie prihlasovacej stránky a predvyplnenie polí
- tmavý moderný overlay vhodný pre TV aj emulátor
- podpora Android TV launcheru

## Ako otvoriť v GitHube / Android Studio

1. Rozbaľ ZIP.
2. Nahraj priečinok do GitHub repozitára.
3. Otvor projekt v Android Studio.
4. Počkaj na Gradle sync.
5. Spusť na Android TV, mobile alebo Android emulátore.

## Použitie

1. Spusti appku.
2. Klikni 5× na logo `S` vľavo hore.
3. Zadaj prihlasovacie údaje.
4. Klikni `Uložiť a prihlásiť`.
5. Po úspešnom prihlásení si WebView uloží cookies a nabudúce by si nemal zadávať login manuálne.

## Poznámka

Toto je legálny wrapper pre tvoj vlastný účet. Neobchádza ochrany ani platby. Ak stránka zmení HTML prihlasovacieho formulára, môže byť potrebné upraviť JS autofill selektory v `MainActivity.kt`.

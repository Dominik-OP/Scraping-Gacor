"""Indonesian location resolution and regional aggregation for collected X posts.

X rarely attaches geotags to posts, so most locations come from the author's
self-reported profile location. Results are indicative: profile text can be
outdated, humorous, or describe a place the author does not live in.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, Iterable


@dataclass(frozen=True)
class Province:
    code: str
    name: str
    lat: float
    lon: float
    col: int  # Tile-grid map position, west to east.
    row: int  # Tile-grid map position, north to south.
    aliases: tuple[str, ...]


PROVINCES: tuple[Province, ...] = (
    Province("ACEH", "Aceh", 4.70, 96.75, 0, 0, ("aceh", "nad", "nanggroe aceh darussalam")),
    Province("SUMUT", "Sumatera Utara", 2.11, 99.54, 1, 1, (
        "sumatera utara", "sumatra utara", "sumut", "north sumatra", "north sumatera")),
    Province("RIAU", "Riau", 0.29, 101.71, 2, 1, ("riau",)),
    Province("KEPRI", "Kepulauan Riau", 1.00, 104.50, 3, 1, ("kepulauan riau", "kepri", "riau islands")),
    Province("SUMBAR", "Sumatera Barat", -0.74, 100.80, 1, 2, (
        "sumatera barat", "sumatra barat", "sumbar", "west sumatra", "west sumatera", "ranah minang", "minang")),
    Province("JAMBI", "Jambi", -1.61, 103.61, 2, 2, ("jambi",)),
    Province("BENGKULU", "Bengkulu", -3.79, 102.26, 1, 3, ("bengkulu",)),
    Province("SUMSEL", "Sumatera Selatan", -3.32, 104.00, 2, 3, (
        "sumatera selatan", "sumatra selatan", "sumsel", "south sumatra", "south sumatera")),
    Province("BABEL", "Kepulauan Bangka Belitung", -2.74, 106.44, 3, 3, (
        "bangka belitung", "kepulauan bangka belitung", "babel", "bangka", "belitung")),
    Province("LAMPUNG", "Lampung", -4.56, 105.41, 2, 4, ("lampung",)),
    Province("DKI", "DKI Jakarta", -6.20, 106.85, 4, 4, (
        "jakarta", "dki jakarta", "dki", "jkt", "batavia", "jakarta raya", "daerah khusus jakarta")),
    Province("BANTEN", "Banten", -6.40, 106.06, 3, 5, ("banten",)),
    Province("JABAR", "Jawa Barat", -6.90, 107.60, 4, 5, ("jawa barat", "jabar", "west java")),
    Province("JATENG", "Jawa Tengah", -7.15, 110.14, 5, 5, ("jawa tengah", "jateng", "central java")),
    Province("DIY", "DI Yogyakarta", -7.80, 110.37, 5, 6, (
        "yogyakarta", "di yogyakarta", "diy", "daerah istimewa yogyakarta", "jogja", "jogjakarta",
        "yogya", "djogja", "jogya", "ygy", "yogyakarta special region")),
    Province("JATIM", "Jawa Timur", -7.54, 112.24, 6, 5, ("jawa timur", "jatim", "east java")),
    Province("BALI", "Bali", -8.41, 115.19, 7, 6, ("bali",)),
    Province("NTB", "Nusa Tenggara Barat", -8.65, 117.36, 8, 6, (
        "nusa tenggara barat", "ntb", "west nusa tenggara", "lombok", "sumbawa")),
    Province("NTT", "Nusa Tenggara Timur", -8.66, 121.08, 9, 6, (
        "nusa tenggara timur", "ntt", "east nusa tenggara", "flores", "sumba", "timor")),
    Province("KALBAR", "Kalimantan Barat", -0.28, 111.48, 5, 2, (
        "kalimantan barat", "kalbar", "west kalimantan")),
    Province("KALTENG", "Kalimantan Tengah", -1.68, 113.38, 6, 2, (
        "kalimantan tengah", "kalteng", "central kalimantan")),
    Province("KALSEL", "Kalimantan Selatan", -3.09, 115.28, 7, 3, (
        "kalimantan selatan", "kalsel", "south kalimantan")),
    Province("KALTIM", "Kalimantan Timur", 0.54, 116.42, 7, 2, (
        "kalimantan timur", "kaltim", "east kalimantan")),
    Province("KALTARA", "Kalimantan Utara", 3.07, 116.04, 7, 1, (
        "kalimantan utara", "kaltara", "north kalimantan")),
    Province("SULBAR", "Sulawesi Barat", -2.84, 119.23, 8, 3, ("sulawesi barat", "sulbar", "west sulawesi")),
    Province("GORONTALO", "Gorontalo", 0.70, 122.45, 9, 1, ("gorontalo",)),
    Province("SULUT", "Sulawesi Utara", 0.62, 123.98, 10, 1, ("sulawesi utara", "sulut", "north sulawesi")),
    Province("SULTENG", "Sulawesi Tengah", -1.43, 121.45, 9, 2, (
        "sulawesi tengah", "sulteng", "central sulawesi")),
    Province("SULSEL", "Sulawesi Selatan", -3.67, 119.97, 9, 3, (
        "sulawesi selatan", "sulsel", "south sulawesi")),
    Province("SULTRA", "Sulawesi Tenggara", -4.14, 122.17, 10, 3, (
        "sulawesi tenggara", "sultra", "southeast sulawesi")),
    Province("MALUT", "Maluku Utara", 1.57, 127.81, 11, 1, ("maluku utara", "malut", "north maluku")),
    Province("MALUKU", "Maluku", -3.24, 130.15, 11, 3, ("maluku", "moluccas")),
    Province("PBD", "Papua Barat Daya", -0.88, 131.25, 12, 2, ("papua barat daya", "southwest papua")),
    Province("PABAR", "Papua Barat", -1.34, 133.17, 13, 2, ("papua barat", "west papua", "pabar")),
    Province("PAPUA", "Papua", -2.53, 140.72, 15, 2, ("papua",)),
    Province("PTENG", "Papua Tengah", -3.37, 135.50, 14, 3, ("papua tengah", "central papua")),
    Province("PPEG", "Papua Pegunungan", -4.10, 138.95, 15, 3, ("papua pegunungan", "highland papua")),
    Province("PSEL", "Papua Selatan", -7.00, 139.50, 15, 4, ("papua selatan", "south papua")),
)
PROVINCE_BY_CODE = {province.code: province for province in PROVINCES}

# name | province | lat | lon | extra aliases (the lowercase name is always an alias)
_CITY_TABLE = """
Jakarta Pusat|DKI|-6.1805|106.8284|jakpus,central jakarta,tanah abang,menteng,senen,gambir,kemayoran,senayan,cempaka putih,sawah besar
Jakarta Selatan|DKI|-6.2615|106.8106|jaksel,south jakarta,kebayoran,kebayoran baru,kemang,cilandak,tebet,pancoran,pasar minggu,mampang,jagakarsa,setiabudi,blok m,scbd,pondok indah
Jakarta Barat|DKI|-6.1683|106.7588|jakbar,west jakarta,grogol,cengkareng,kebon jeruk,kalideres,palmerah,tambora
Jakarta Timur|DKI|-6.2250|106.9004|jaktim,east jakarta,cakung,duren sawit,jatinegara,kramat jati,pulo gadung,matraman,cipayung,ciracas,cibubur,rawamangun
Jakarta Utara|DKI|-6.1384|106.8636|jakut,north jakarta,kelapa gading,tanjung priok,pluit,penjaringan,koja,cilincing,ancol,pantai indah kapuk,pik
Kepulauan Seribu|DKI|-5.7985|106.5072|pulau seribu,thousand islands
Bandung|JABAR|-6.9175|107.6191|kota bandung,kabupaten bandung,kab bandung,bdg,bandoeng
Bandung Barat|JABAR|-6.8652|107.4919|kbb,lembang
Cimahi|JABAR|-6.8722|107.5425|
Bekasi|JABAR|-6.2383|106.9756|kota bekasi,kabupaten bekasi,kab bekasi,bks,cikarang
Bogor|JABAR|-6.5950|106.8166|kota bogor,kabupaten bogor,kab bogor,cibinong
Depok|JABAR|-6.4025|106.7942|
Cirebon|JABAR|-6.7320|108.5523|
Sukabumi|JABAR|-6.9277|106.9300|
Tasikmalaya|JABAR|-7.3274|108.2207|tasik
Garut|JABAR|-7.2279|107.9087|
Karawang|JABAR|-6.3227|107.3376|
Purwakarta|JABAR|-6.5569|107.4433|
Subang|JABAR|-6.5714|107.7587|
Indramayu|JABAR|-6.3264|108.3200|
Majalengka|JABAR|-6.8364|108.2274|
Kuningan|JABAR|-6.9759|108.4836|
Sumedang|JABAR|-6.8586|107.9164|jatinangor
Cianjur|JABAR|-6.8168|107.1425|
Ciamis|JABAR|-7.3257|108.3534|
Pangandaran|JABAR|-7.6956|108.6500|
Tangerang|BANTEN|-6.1783|106.6319|kota tangerang,kabupaten tangerang,kab tangerang,tng,karawaci
Tangerang Selatan|BANTEN|-6.2886|106.7179|tangsel,south tangerang,serpong,bsd,pamulang,ciputat,bintaro
Serang|BANTEN|-6.1200|106.1503|kota serang
Cilegon|BANTEN|-6.0174|106.0538|
Pandeglang|BANTEN|-6.3086|106.1064|
Lebak|BANTEN|-6.5644|106.2522|rangkasbitung
Semarang|JATENG|-6.9667|110.4167|smg,kota semarang,ungaran
Surakarta|JATENG|-7.5755|110.8243|solo,kota solo,kota surakarta
Magelang|JATENG|-7.4797|110.2177|
Salatiga|JATENG|-7.3305|110.5084|
Pekalongan|JATENG|-6.8898|109.6746|
Tegal|JATENG|-6.8694|109.1402|
Banyumas|JATENG|-7.4243|109.2302|purwokerto
Cilacap|JATENG|-7.7266|109.0091|
Kudus|JATENG|-6.8048|110.8405|
Jepara|JATENG|-6.5887|110.6684|
Pati|JATENG|-6.7559|111.0380|
Rembang|JATENG|-6.7084|111.3420|
Klaten|JATENG|-7.7059|110.6061|
Boyolali|JATENG|-7.5317|110.5960|
Sukoharjo|JATENG|-7.6809|110.8200|
Karanganyar|JATENG|-7.5961|110.9508|
Sragen|JATENG|-7.4302|111.0092|
Wonogiri|JATENG|-7.8136|110.9259|
Kebumen|JATENG|-7.6681|109.6520|
Purworejo|JATENG|-7.7136|110.0089|
Wonosobo|JATENG|-7.3632|109.9002|dieng
Temanggung|JATENG|-7.3148|110.1749|
Kendal|JATENG|-6.9196|110.2063|
Demak|JATENG|-6.8906|110.6386|
Grobogan|JATENG|-7.0217|110.9626|purwodadi
Blora|JATENG|-6.9698|111.4186|cepu
Brebes|JATENG|-6.8724|109.0400|
Pemalang|JATENG|-6.8908|109.3803|
Purbalingga|JATENG|-7.3880|109.3627|
Banjarnegara|JATENG|-7.3964|109.6946|
Batang|JATENG|-6.9070|109.7300|
Kota Yogyakarta|DIY|-7.7956|110.3695|kota jogja,kota yogya,malioboro
Sleman|DIY|-7.7166|110.3557|
Bantul|DIY|-7.8881|110.3289|
Kulon Progo|DIY|-7.8245|110.1641|kulonprogo,wates
Gunungkidul|DIY|-7.9654|110.6040|gunung kidul,wonosari
Surabaya|JATIM|-7.2575|112.7521|sby,suroboyo,kota surabaya
Malang|JATIM|-7.9666|112.6326|kota malang,kabupaten malang,kab malang,mlg
Batu|JATIM|-7.8671|112.5239|kota batu
Sidoarjo|JATIM|-7.4478|112.7183|sda
Gresik|JATIM|-7.1539|112.6561|
Mojokerto|JATIM|-7.4722|112.4338|
Kediri|JATIM|-7.8480|112.0178|
Blitar|JATIM|-8.0954|112.1609|
Madiun|JATIM|-7.6298|111.5239|
Jember|JATIM|-8.1724|113.7000|
Banyuwangi|JATIM|-8.2192|114.3691|
Pasuruan|JATIM|-7.6453|112.9075|
Probolinggo|JATIM|-7.7543|113.2159|
Lamongan|JATIM|-7.1167|112.4167|
Tuban|JATIM|-6.8976|112.0500|
Bojonegoro|JATIM|-7.1502|111.8817|
Ngawi|JATIM|-7.4038|111.4461|
Ponorogo|JATIM|-7.8651|111.4696|
Pacitan|JATIM|-8.1944|111.1056|
Tulungagung|JATIM|-8.0657|111.9025|
Trenggalek|JATIM|-8.0500|111.7167|
Lumajang|JATIM|-8.1335|113.2248|
Bondowoso|JATIM|-7.9135|113.8215|
Situbondo|JATIM|-7.7069|114.0094|
Jombang|JATIM|-7.5460|112.2330|
Nganjuk|JATIM|-7.6051|111.9035|
Magetan|JATIM|-7.6493|111.3381|
Madura|JATIM|-7.0500|113.4000|bangkalan,sampang,pamekasan,sumenep
Denpasar|BALI|-8.6705|115.2126|dps
Badung|BALI|-8.5819|115.1771|kuta,seminyak,canggu,nusa dua,jimbaran,legian
Gianyar|BALI|-8.5444|115.3253|ubud
Tabanan|BALI|-8.5375|115.1250|
Buleleng|BALI|-8.1120|115.0882|singaraja,lovina
Karangasem|BALI|-8.4489|115.6067|amlapura
Klungkung|BALI|-8.5389|115.4045|semarapura,nusa penida
Jembrana|BALI|-8.3606|114.6418|
Bangli|BALI|-8.4544|115.3549|kintamani
Mataram|NTB|-8.5833|116.1167|
Lombok Tengah|NTB|-8.7000|116.2700|praya,mandalika
Bima|NTB|-8.4600|118.7270|
Dompu|NTB|-8.5365|118.4634|
Sumbawa Besar|NTB|-8.4932|117.4200|
Kupang|NTT|-10.1772|123.6070|
Ende|NTT|-8.8432|121.6623|
Maumere|NTT|-8.6199|122.2111|sikka
Labuan Bajo|NTT|-8.4964|119.8877|manggarai barat,komodo
Ruteng|NTT|-8.6136|120.4721|manggarai
Atambua|NTT|-9.1061|124.8925|belu
Waingapu|NTT|-9.6566|120.2641|sumba timur
Alor|NTT|-8.2200|124.5300|kalabahi
Rote Ndao|NTT|-10.7380|123.1180|rote
Timor Tengah Selatan|NTT|-9.8300|124.2800|soe
Timor Tengah Utara|NTT|-9.4600|124.4800|kefamenanu
Banda Aceh|ACEH|5.5483|95.3238|bna
Lhokseumawe|ACEH|5.1801|97.1507|
Langsa|ACEH|4.4683|97.9683|
Sabang|ACEH|5.8946|95.3192|
Meulaboh|ACEH|4.1363|96.1285|aceh barat
Takengon|ACEH|4.6240|96.8460|aceh tengah,gayo
Bireuen|ACEH|5.2030|96.7000|
Pidie|ACEH|5.0700|96.0000|sigli
Aceh Utara|ACEH|5.0000|97.2000|lhoksukon
Aceh Besar|ACEH|5.3800|95.5200|jantho
Asahan|SUMUT|2.9800|99.6200|kisaran
Langkat|SUMUT|3.7500|98.2800|stabat
Serdang Bedagai|SUMUT|3.3600|99.0500|sei rampah
Medan|SUMUT|3.5952|98.6722|kota medan,mdn
Binjai|SUMUT|3.6001|98.4854|
Pematangsiantar|SUMUT|2.9595|99.0687|siantar,pematang siantar
Deli Serdang|SUMUT|3.4202|98.7041|lubuk pakam
Tebing Tinggi|SUMUT|3.3285|99.1625|
Sibolga|SUMUT|1.7427|98.7792|
Padangsidimpuan|SUMUT|1.3790|99.2715|padang sidempuan,padangsidempuan,padang sidimpuan
Toba|SUMUT|2.3333|99.0667|danau toba,balige,parapat
Samosir|SUMUT|2.5833|98.8167|
Nias|SUMUT|1.1000|97.5500|gunungsitoli
Karo|SUMUT|3.1000|98.4900|berastagi,brastagi,kabanjahe
Labuhanbatu|SUMUT|2.1000|99.8333|rantau prapat,rantauprapat
Padang|SUMBAR|-0.9471|100.4172|kota padang,pdg
Bukittinggi|SUMBAR|-0.3055|100.3692|bukit tinggi
Payakumbuh|SUMBAR|-0.2244|100.6325|
Solok|SUMBAR|-0.7900|100.6500|
Pariaman|SUMBAR|-0.6264|100.1179|
Sawahlunto|SUMBAR|-0.6829|100.7778|
Padang Panjang|SUMBAR|-0.4566|100.4078|
Pesisir Selatan|SUMBAR|-1.3500|100.5800|painan
Agam|SUMBAR|-0.2500|100.1700|lubuk basung
Tanah Datar|SUMBAR|-0.4600|100.5800|batusangkar
Lima Puluh Kota|SUMBAR|-0.0200|100.5600|limapuluh kota
Pekanbaru|RIAU|0.5071|101.4478|pku,pekan baru
Dumai|RIAU|1.6667|101.4500|
Siak|RIAU|0.7900|102.0500|
Kampar|RIAU|0.3300|101.0500|bangkinang
Bengkalis|RIAU|1.4700|102.1000|
Indragiri Hilir|RIAU|-0.3500|103.1000|tembilahan
Batam|KEPRI|1.0456|104.0305|btm
Tanjungpinang|KEPRI|0.9186|104.4554|tanjung pinang
Bintan|KEPRI|1.0800|104.4800|
Karimun|KEPRI|1.0500|103.4000|tanjung balai karimun
Natuna|KEPRI|3.9500|108.2000|ranai
Kota Jambi|JAMBI|-1.6101|103.6131|
Kerinci|JAMBI|-1.7000|101.2600|sungai penuh,sungaipenuh
Bungo|JAMBI|-1.5000|102.1000|muara bungo
Palembang|SUMSEL|-2.9761|104.7754|plg
Prabumulih|SUMSEL|-3.4290|104.2350|
Lubuklinggau|SUMSEL|-3.2967|102.8617|lubuk linggau
Lahat|SUMSEL|-3.7860|103.5420|
Baturaja|SUMSEL|-4.1280|104.1660|ogan komering ulu
Pagar Alam|SUMSEL|-4.0167|103.2500|pagaralam
Musi Banyuasin|SUMSEL|-2.8500|104.0000|sekayu
Ogan Ilir|SUMSEL|-3.2400|104.6500|indralaya,inderalaya
Pangkalpinang|BABEL|-2.1291|106.1138|pangkal pinang
Tanjung Pandan|BABEL|-2.7500|107.6500|tanjungpandan
Kota Bengkulu|BENGKULU|-3.8004|102.2655|
Rejang Lebong|BENGKULU|-3.4500|102.5300|curup
Bandar Lampung|LAMPUNG|-5.4294|105.2611|bandarlampung,balam,tanjung karang,teluk betung,telukbetung
Lampung Selatan|LAMPUNG|-5.7300|105.6000|kalianda
Lampung Tengah|LAMPUNG|-4.8000|105.3000|gunung sugih
Pringsewu|LAMPUNG|-5.3580|104.9740|
Lampung Timur|LAMPUNG|-5.1000|105.6800|sukadana
Lampung Utara|LAMPUNG|-4.8300|104.8700|kotabumi
Tulang Bawang|LAMPUNG|-4.4300|105.5500|menggala
Tanggamus|LAMPUNG|-5.4400|104.6200|kota agung
Pesawaran|LAMPUNG|-5.4900|105.0800|
Kota Metro|LAMPUNG|-5.1130|105.3070|
Pontianak|KALBAR|-0.0263|109.3425|ptk
Singkawang|KALBAR|0.9061|108.9872|
Ketapang|KALBAR|-1.8500|109.9800|
Sintang|KALBAR|0.0700|111.5000|
Kubu Raya|KALBAR|-0.3500|109.4000|
Sambas|KALBAR|1.3600|109.3000|
Palangka Raya|KALTENG|-2.2161|113.9135|palangkaraya,pky
Sampit|KALTENG|-2.5333|112.9500|kotawaringin timur
Pangkalan Bun|KALTENG|-2.6833|111.6167|kotawaringin barat
Banjarmasin|KALSEL|-3.3186|114.5944|bjm
Banjarbaru|KALSEL|-3.4420|114.8300|banjar baru
Kotabaru|KALSEL|-3.2900|116.1700|
Tanah Laut|KALSEL|-3.8000|114.8000|pelaihari
Samarinda|KALTIM|-0.5022|117.1536|smd
Balikpapan|KALTIM|-1.2379|116.8529|bpn
Bontang|KALTIM|0.1333|117.5000|
Kutai Kartanegara|KALTIM|-0.4400|116.9800|kukar,tenggarong
Kutai Timur|KALTIM|0.5500|117.5000|kutim,sangatta
Penajam Paser Utara|KALTIM|-1.2900|116.5300|ppu,penajam,ikn,ibu kota nusantara
Berau|KALTIM|2.1500|117.4900|tanjung redeb
Tarakan|KALTARA|3.3000|117.6333|
Tanjung Selor|KALTARA|2.8375|117.3653|bulungan
Nunukan|KALTARA|4.1333|117.6667|
Malinau|KALTARA|3.5900|116.6400|
Manado|SULUT|1.4748|124.8421|mdo,menado
Bitung|SULUT|1.4404|125.1217|
Tomohon|SULUT|1.3260|124.8390|
Kotamobagu|SULUT|0.7333|124.3167|
Minahasa|SULUT|1.2500|124.8300|tondano
Limboto|GORONTALO|0.6300|122.9400|
Palu|SULTENG|-0.8917|119.8707|kota palu
Poso|SULTENG|-1.3900|120.7500|
Luwuk|SULTENG|-0.9500|122.7900|banggai
Tolitoli|SULTENG|1.0400|120.8200|toli toli
Morowali|SULTENG|-2.5000|121.8000|
Mamuju|SULBAR|-2.6748|118.8885|
Majene|SULBAR|-3.5400|118.9700|
Polewali Mandar|SULBAR|-3.4200|119.3400|polman,polewali
Makassar|SULSEL|-5.1477|119.4327|mks,ujung pandang,ujungpandang,makasar
Parepare|SULSEL|-4.0135|119.6255|pare pare
Palopo|SULSEL|-2.9925|120.1969|
Gowa|SULSEL|-5.3100|119.7400|sungguminasa
Maros|SULSEL|-5.0000|119.5700|
Bone|SULSEL|-4.5390|120.3250|watampone
Toraja|SULSEL|-3.0000|119.8600|tana toraja,toraja utara,rantepao,makale
Bulukumba|SULSEL|-5.5500|120.1900|
Sidrap|SULSEL|-3.9000|119.8000|sidenreng rappang
Wajo|SULSEL|-4.0000|120.0700|sengkang
Takalar|SULSEL|-5.4100|119.4900|
Jeneponto|SULSEL|-5.6800|119.7300|
Bantaeng|SULSEL|-5.5500|119.9500|
Sinjai|SULSEL|-5.1200|120.2500|
Enrekang|SULSEL|-3.5600|119.7800|
Pangkep|SULSEL|-4.8400|119.5500|pangkajene
Barru|SULSEL|-4.4100|119.6200|
Selayar|SULSEL|-6.1200|120.4600|kepulauan selayar
Luwu|SULSEL|-3.3000|120.2500|luwu utara,luwu timur,masamba
Kendari|SULTRA|-3.9985|122.5130|kdi
Baubau|SULTRA|-5.4700|122.6300|bau bau
Kolaka|SULTRA|-4.0500|121.5900|
Wakatobi|SULTRA|-5.3200|123.5500|
Muna|SULTRA|-4.8300|122.7300|raha
Ambon|MALUKU|-3.6954|128.1814|
Tual|MALUKU|-5.6300|132.7500|
Masohi|MALUKU|-3.3000|128.9500|maluku tengah
Saumlaki|MALUKU|-7.9800|131.3000|
Kepulauan Aru|MALUKU|-6.1700|134.4500|dobo
Ternate|MALUT|0.7893|127.3753|
Tidore|MALUT|0.6800|127.4000|
Sofifi|MALUT|0.7400|127.5600|
Halmahera|MALUT|1.0000|128.0000|tobelo
Morotai|MALUT|2.2000|128.3000|
Jayapura|PAPUA|-2.5337|140.7181|jpr
Sentani|PAPUA|-2.5700|140.5100|
Biak|PAPUA|-1.1800|136.0800|biak numfor
Manokwari|PABAR|-0.8615|134.0620|
Fakfak|PABAR|-2.9200|132.3000|fak fak
Kaimana|PABAR|-3.6500|133.7500|
Teluk Bintuni|PABAR|-2.1000|133.5000|bintuni
Sorong|PBD|-0.8762|131.2558|
Raja Ampat|PBD|-0.5000|130.5000|waisai
Nabire|PTENG|-3.3667|135.4833|
Timika|PTENG|-4.5500|136.8900|mimika
Paniai|PTENG|-3.9000|136.3500|enarotali
Wamena|PPEG|-4.0975|138.9473|jayawijaya
Merauke|PSEL|-8.4932|140.4018|
Boven Digoel|PSEL|-6.1000|140.3000|
"""

ISLANDS = {
    "sumatera": "Sumatra", "sumatra": "Sumatra", "jawa": "Java", "java": "Java",
    "kalimantan": "Kalimantan", "borneo": "Kalimantan", "sulawesi": "Sulawesi",
    "celebes": "Sulawesi", "nusa tenggara": "Nusa Tenggara",
}

INDONESIA_ALIASES = (
    "indonesia", "indonesian", "republik indonesia", "republic of indonesia", "nkri",
    "nusantara", "bumi nusantara", "indo", "tanah air", "ibu pertiwi",
)

FOREIGN = {
    "Malaysia": ("malaysia", "kuala lumpur", "kl", "johor", "johor bahru", "penang", "selangor", "sabah",
                 "sarawak", "kuching", "kota kinabalu", "melaka", "malacca", "putrajaya", "ipoh"),
    "Singapore": ("singapore", "singapura", "sg"),
    "Brunei": ("brunei", "bandar seri begawan"),
    "Timor-Leste": ("timor leste", "east timor", "dili"),
    "Thailand": ("thailand", "bangkok", "phuket"),
    "Philippines": ("philippines", "filipina", "manila"),
    "Vietnam": ("vietnam", "hanoi", "ho chi minh"),
    "Australia": ("australia", "sydney", "melbourne", "perth", "brisbane"),
    "Japan": ("japan", "jepang", "tokyo", "osaka", "kyoto", "nihon"),
    "South Korea": ("korea", "south korea", "korea selatan", "korsel", "seoul", "busan"),
    "China": ("china", "tiongkok", "beijing", "shanghai"),
    "Hong Kong": ("hong kong", "hongkong", "hk"),
    "Taiwan": ("taiwan", "taipei"),
    "India": ("india", "mumbai", "new delhi", "delhi"),
    "Saudi Arabia": ("saudi arabia", "arab saudi", "saudi", "mekkah", "makkah", "mecca", "madinah",
                     "medina", "riyadh", "jeddah"),
    "United Arab Emirates": ("uae", "dubai", "abu dhabi", "uni emirat arab"),
    "Qatar": ("qatar", "doha"),
    "Turkey": ("turkey", "turki", "turkiye", "istanbul", "ankara"),
    "Egypt": ("egypt", "mesir", "cairo", "kairo"),
    "United Kingdom": ("united kingdom", "uk", "england", "inggris", "london", "manchester", "scotland"),
    "Netherlands": ("netherlands", "belanda", "nederland", "amsterdam", "rotterdam", "den haag", "the hague"),
    "Germany": ("germany", "jerman", "deutschland", "berlin", "munich", "munchen", "frankfurt"),
    "France": ("france", "prancis", "perancis", "paris"),
    "Spain": ("spain", "spanyol", "espana", "madrid", "barcelona", "cataluna", "catalunya"),
    "Italy": ("italy", "italia", "rome", "roma"),
    "United States": ("united states", "usa", "amerika", "america", "amerika serikat", "new york", "nyc",
                      "los angeles", "california", "texas", "chicago", "san francisco"),
    "Canada": ("canada", "kanada", "toronto", "vancouver"),
    "Russia": ("russia", "rusia", "moscow"),
    "New Zealand": ("new zealand", "selandia baru", "auckland"),
}

FLAG_COUNTRIES = {
    "ID": "Indonesia", "MY": "Malaysia", "SG": "Singapore", "BN": "Brunei", "TL": "Timor-Leste",
    "TH": "Thailand", "PH": "Philippines", "VN": "Vietnam", "AU": "Australia", "JP": "Japan",
    "KR": "South Korea", "CN": "China", "HK": "Hong Kong", "TW": "Taiwan", "IN": "India",
    "SA": "Saudi Arabia", "AE": "United Arab Emirates", "QA": "Qatar", "TR": "Turkey", "EG": "Egypt",
    "GB": "United Kingdom", "NL": "Netherlands", "DE": "Germany", "FR": "France", "ES": "Spain",
    "IT": "Italy", "US": "United States", "CA": "Canada", "RU": "Russia", "NZ": "New Zealand",
    "PS": "Palestine",
}

# Common words that are also place names: in post text they count only when capitalized.
AMBIGUOUS_ALIASES = {
    "malang", "padang", "medan", "solo", "batu", "bone", "batang", "serang", "palu", "kudus",
    "tegal", "lebak", "bima", "pati", "ende", "muna", "raha", "toba", "kuta", "garut", "timor",
    "sumba", "kendal", "tuban", "siak", "wates", "praya", "berau", "alor", "rote", "kampar", "dieng",
    "sabang", "nias", "biak", "flores", "karo", "subang", "solok", "maros", "wajo", "lahat",
}
# Aliases too generic for post text even when capitalized.
TEXT_EXCLUDED_ALIASES = {"babel", "minang", "ranah minang", "dki", "indo", "kbb", "bsd", "pik", "ppu", "ikn",
                         "sby", "smg", "bdg", "bks", "tng", "mlg", "sda", "dps", "bna", "mdn", "pdg", "pku",
                         "btm", "plg", "ptk", "pky", "bjm", "smd", "bpn", "mdo", "mks", "kdi", "jpr", "ygy",
                         "jkt", "balam", "scbd", "blok m", "nad", "komodo"}

INDONESIA_BOUNDS = (-11.5, 6.5, 94.5, 141.5)  # min lat, max lat, min lon, max lon


@dataclass(frozen=True)
class City:
    name: str
    province: str
    lat: float
    lon: float


def _parse_cities() -> tuple[tuple[City, tuple[str, ...]], ...]:
    rows = []
    for line in _CITY_TABLE.strip().splitlines():
        name, province, lat, lon, extra = line.split("|")
        if province not in PROVINCE_BY_CODE:
            raise ValueError(f"Unknown province code for {name}: {province}")
        aliases = (name.lower(), *(alias.strip() for alias in extra.split(",") if alias.strip()))
        rows.append((City(name, province, float(lat), float(lon)), aliases))
    return tuple(rows)


CITIES = _parse_cities()


def _tokens(value: str) -> list[str]:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char)).lower()
    return re.sub(r"[^a-z0-9]+", " ", value).split()


# Lower rank wins when a location string contains several places.
RANK = {"city": 0, "province": 1, "island": 2, "country": 3, "foreign": 4}


def _build_index() -> dict[tuple[str, ...], tuple[str, Any, str]]:
    index: dict[tuple[str, ...], tuple[str, Any, str]] = {}

    def add(alias: str, kind: str, ref: Any) -> None:
        key = tuple(_tokens(alias))
        if not key:
            return
        if key in index and index[key][:2] != (kind, ref):
            raise ValueError(f"Duplicate location alias: {alias}")
        index[key] = (kind, ref, " ".join(key))

    for province in PROVINCES:
        for alias in (province.name.lower(), *province.aliases):
            add(alias, "province", province.code)
    for position, (_, aliases) in enumerate(CITIES):
        for alias in aliases:
            add(alias, "city", position)
    for alias, island in ISLANDS.items():
        add(alias, "island", island)
    for alias in INDONESIA_ALIASES:
        add(alias, "country", "Indonesia")
    for country, aliases in FOREIGN.items():
        for alias in aliases:
            add(alias, "foreign", country)
    return index


ALIAS_INDEX = _build_index()
MAX_ALIAS_TOKENS = max(len(key) for key in ALIAS_INDEX)


@dataclass(frozen=True)
class Location:
    kind: str = "unknown"  # city | province | island | country | foreign | unknown
    source: str | None = None  # place | coordinates | profile | flag
    country: str | None = None
    province_code: str | None = None
    province: str | None = None
    city: str | None = None
    island: str | None = None
    lat: float | None = None
    lon: float | None = None

    @property
    def label(self) -> str:
        if self.city and self.province:
            return f"{self.city}, {self.province}"
        if self.province:
            return self.province
        if self.island:
            return f"{self.island}, Indonesia"
        return self.country or ""

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "label": self.label}


UNKNOWN = Location()


def _match(tokens: list[str]) -> list[tuple[int, str, Any, str]]:
    found = []
    index = 0
    while index < len(tokens):
        for size in range(min(MAX_ALIAS_TOKENS, len(tokens) - index), 0, -1):
            entry = ALIAS_INDEX.get(tuple(tokens[index:index + size]))
            if entry:
                found.append((index, *entry))
                index += size
                break
        else:
            index += 1
    return found


def _location_from_entry(kind: str, ref: Any, source: str) -> Location:
    if kind == "city":
        city = CITIES[ref][0]
        province = PROVINCE_BY_CODE[city.province]
        return Location("city", source, "Indonesia", province.code, province.name, city.name,
                        lat=city.lat, lon=city.lon)
    if kind == "province":
        province = PROVINCE_BY_CODE[ref]
        return Location("province", source, "Indonesia", province.code, province.name,
                        lat=province.lat, lon=province.lon)
    if kind == "island":
        return Location("island", source, "Indonesia", island=ref)
    if kind == "country":
        return Location("country", source, "Indonesia")
    return Location("foreign", source, ref)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((phi2 - phi1) / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def locate_coordinates(lat: float, lon: float, source: str = "coordinates") -> Location:
    min_lat, max_lat, min_lon, max_lon = INDONESIA_BOUNDS
    if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
        return Location("foreign", source, "Outside Indonesia", lat=lat, lon=lon)
    nearest, distance = min(
        ((city, _haversine_km(lat, lon, city.lat, city.lon)) for city, _ in CITIES),
        key=lambda pair: pair[1],
    )
    province = PROVINCE_BY_CODE[nearest.province]
    # Beyond 60 km, the nearest gazetteer city is only a province-level hint.
    city = nearest.name if distance <= 60 else None
    return Location("city" if city else "province", source, "Indonesia", province.code, province.name,
                    city, lat=lat, lon=lon)


_COORDINATES = re.compile(r"(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})")
_FLAG = re.compile("[\U0001F1E6-\U0001F1FF]{2}")


@lru_cache(maxsize=8192)
def resolve_location(profile: str | None, place: str | None = None, place_country: str | None = None) -> Location:
    """Resolve a tweet place or self-reported profile location into a region."""
    if place:
        resolved = _resolve_text(place, "place")
        if resolved.kind != "unknown":
            return resolved
    if place_country:
        code = place_country.strip().upper()
        if code == "ID":
            return Location("country", "place", "Indonesia")
        if len(code) == 2:
            return Location("foreign", "place", FLAG_COUNTRIES.get(code, code))
    if not profile or not profile.strip():
        return UNKNOWN
    coordinates = _COORDINATES.search(profile)
    if coordinates:
        lat, lon = float(coordinates.group(1)), float(coordinates.group(2))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return locate_coordinates(lat, lon)
    resolved = _resolve_text(profile, "profile")
    if resolved.kind in {"city", "province", "island", "country"}:
        return resolved
    flags = [
        "".join(chr(ord(char) - 0x1F1E6 + ord("A")) for char in flag)
        for flag in _FLAG.findall(profile)
    ]
    if "ID" in flags or "+62" in profile:
        return Location("country", "flag", "Indonesia")
    if resolved.kind == "foreign":
        return resolved
    if flags:
        return Location("foreign", "flag", FLAG_COUNTRIES.get(flags[0], flags[0]))
    return UNKNOWN


def _resolve_text(value: str, source: str) -> Location:
    matches = _match(_tokens(value))
    if not matches:
        return UNKNOWN
    locations = [_location_from_entry(kind, ref, source) for _, kind, ref, _ in matches]
    provinces = {location.province_code for location in locations if location.province_code}
    countries = {location.country for location in locations if location.country}
    if len(provinces) > 1 or len(countries) > 1:
        return UNKNOWN
    cities = {location.city for location in locations if location.city}
    if len(cities) > 1 and len(provinces) == 1:
        return _location_from_entry("province", next(iter(provinces)), source)
    _, kind, ref, _ = min(matches, key=lambda match: (RANK[match[1]], match[0]))
    return _location_from_entry(kind, ref, source)


_TEXT_NOISE = re.compile(r"https?://\S+|@\w+|dari sabang sampai merauke|sabang sampai merauke", re.IGNORECASE)


def find_text_mentions(text: str) -> list[Location]:
    """Return Indonesian regions mentioned in post text (one per province)."""
    if not text:
        return []
    cleaned = _TEXT_NOISE.sub(" ", text)
    found: dict[str, Location] = {}
    for _, kind, ref, alias in _match(_tokens(cleaned)):
        if kind not in {"city", "province"} or alias in TEXT_EXCLUDED_ALIASES:
            continue
        if alias in AMBIGUOUS_ALIASES and not re.search(
            rf"(?<!\w){re.escape(alias.title())}(?!\w)|(?<!\w){re.escape(alias.upper())}(?!\w)", cleaned,
        ):
            continue
        location = _location_from_entry(kind, ref, "text")
        current = found.get(location.province_code or "")
        # Keep the more specific city mention for each province.
        if current is None or (current.kind == "province" and location.kind == "city"):
            found[location.province_code or ""] = location
    return list(found.values())


def _post_time(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _engagement(post: dict[str, Any]) -> int:
    return sum(int(post.get(key) or 0) for key in ("like_count", "retweet_count", "reply_count", "quote_count"))


def post_location(post: dict[str, Any]) -> Location:
    return resolve_location(post.get("author_location") or "", post.get("place_name") or "",
                            post.get("place_country") or "")


def summarize_regions(posts: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate posts by author region and by regions mentioned in text."""
    posts = list(posts)
    times = [time for post in posts if (time := _post_time(post.get("created_at")))]
    latest = max(times) if times else None
    spans_days = bool(times) and (latest - min(times)) >= timedelta(hours=36)
    recent_cutoff = latest - timedelta(hours=24) if latest else None

    def empty_bucket() -> dict[str, Any]:
        return {
            "posts": 0, "authors": set(), "threads": set(), "engagement": 0, "views": 0, "recent_posts": 0,
            "sentiment": {"positive": 0, "neutral": 0, "negative": 0},
            "hashtags": Counter(), "cities": Counter(),
        }

    provinces: dict[str, dict[str, Any]] = defaultdict(empty_bucket)
    cities: dict[tuple[str, str], dict[str, Any]] = defaultdict(empty_bucket)
    foreign: Counter[str] = Counter()
    mentions: dict[str, dict[str, Any]] = defaultdict(lambda: {"posts": 0, "engagement": 0, "cities": Counter(),
                                                                "sentiment": Counter()})
    coverage = Counter()
    sources = Counter()
    authors_by_kind: dict[str, set[str]] = defaultdict(set)
    recent_total = 0
    recent_located_total = 0
    threads: set[str] = set()

    for post in posts:
        location = post_location(post)
        author = str(post.get("author_username") or "").lower()
        engagement = _engagement(post)
        time = _post_time(post.get("created_at"))
        is_recent = bool(recent_cutoff and time and time >= recent_cutoff)
        recent_total += is_recent
        thread = str(post.get("conversation_id") or "")
        if thread:
            threads.add(thread)
            coverage["posts_with_thread"] += 1
        try:
            hashtags = json.loads(post.get("hashtags_json") or "[]")
        except (TypeError, json.JSONDecodeError):
            hashtags = []
        sentiment = post.get("sentiment") if post.get("sentiment") in {"positive", "neutral", "negative"} else "neutral"

        if location.province_code:
            coverage["province"] += 1
            recent_located_total += is_recent
        elif location.kind in {"island", "country"}:
            coverage["country"] += 1
        elif location.kind == "foreign":
            coverage["foreign"] += 1
        else:
            coverage["unknown"] += 1
        if location.source:
            sources[location.source] += 1
        authors_by_kind["province" if location.province_code else location.kind].add(author)

        if location.province_code:
            buckets = [provinces[location.province_code]]
            if location.city:
                buckets.append(cities[(location.city, location.province_code)])
                provinces[location.province_code]["cities"][location.city] += 1
            for bucket in buckets:
                bucket["posts"] += 1
                bucket["authors"].add(author)
                if thread:
                    bucket["threads"].add(thread)
                bucket["engagement"] += engagement
                bucket["views"] += int(post.get("view_count") or 0)
                bucket["recent_posts"] += is_recent
                bucket["sentiment"][sentiment] += 1
                bucket["hashtags"].update(hashtags)
        elif location.kind == "foreign" and location.country:
            foreign[location.country] += 1

        for mention in find_text_mentions(str(post.get("text") or "")):
            bucket = mentions[mention.province_code or ""]
            bucket["posts"] += 1
            bucket["engagement"] += engagement
            bucket["sentiment"][sentiment] += 1
            if mention.city:
                bucket["cities"][mention.city] += 1

    total = len(posts)
    max_posts = max((bucket["posts"] for bucket in provinces.values()), default=0)
    max_engagement = max((bucket["engagement"] for bucket in provinces.values()), default=0)
    max_mentions = max((bucket["posts"] for bucket in mentions.values()), default=0)
    max_mention_engagement = max((bucket["engagement"] for bucket in mentions.values()), default=0)
    located_total = coverage["province"]

    def trend(bucket: dict[str, Any]) -> str | None:
        if not spans_days or not recent_located_total or bucket["posts"] < 3:
            return None
        ratio = (bucket["recent_posts"] / recent_located_total) / (bucket["posts"] / max(located_total, 1))
        if bucket["recent_posts"] >= 2 and ratio >= 1.25:
            return "rising"
        if ratio <= 0.6:
            return "cooling"
        return "steady"

    def heat(bucket: dict[str, Any], peak_posts: int | None = None, peak_engagement: int | None = None) -> int:
        peak_posts = max_posts if peak_posts is None else peak_posts
        peak_engagement = max_engagement if peak_engagement is None else peak_engagement
        if not peak_posts or not bucket["posts"]:
            return 0
        volume = bucket["posts"] / peak_posts
        if not peak_engagement:
            return round(100 * volume)
        reach = math.log1p(bucket["engagement"]) / math.log1p(peak_engagement)
        return round(100 * (0.65 * volume + 0.35 * reach))

    def net_sentiment(values: dict[str, int]) -> int:
        count = sum(values.values())
        return round(100 * (values.get("positive", 0) - values.get("negative", 0)) / count) if count else 0

    province_rows = []
    for province in PROVINCES:
        bucket = provinces.get(province.code) or empty_bucket()
        mention_bucket = mentions.get(province.code) or {"posts": 0, "engagement": 0}
        province_rows.append({
            "code": province.code,
            "name": province.name,
            "col": province.col,
            "row": province.row,
            "posts": bucket["posts"],
            "authors": len(bucket["authors"]),
            "threads": len(bucket["threads"]),
            "engagement": bucket["engagement"],
            "views": bucket["views"],
            "share": round(bucket["posts"] / located_total, 4) if located_total else 0,
            "heat": heat(bucket),
            "recent_posts": bucket["recent_posts"],
            "trend": trend(bucket),
            "sentiment": bucket["sentiment"],
            "net_sentiment": net_sentiment(bucket["sentiment"]),
            "top_hashtags": [tag for tag, _ in bucket["hashtags"].most_common(3)],
            "top_cities": [{"name": name, "posts": count} for name, count in bucket["cities"].most_common(3)],
            "mentioned_in": mention_bucket["posts"],
            "mention_heat": heat(mention_bucket, max_mentions, max_mention_engagement),
        })

    city_rows = sorted(
        ({
            "name": name, "province_code": code, "province": PROVINCE_BY_CODE[code].name,
            "posts": bucket["posts"], "authors": len(bucket["authors"]), "engagement": bucket["engagement"],
            "net_sentiment": net_sentiment(bucket["sentiment"]),
        } for (name, code), bucket in cities.items()),
        key=lambda row: (-row["posts"], -row["engagement"], row["name"]),
    )

    mention_rows = sorted(
        ({
            "code": code, "name": PROVINCE_BY_CODE[code].name, "posts": bucket["posts"],
            "engagement": bucket["engagement"], "net_sentiment": net_sentiment(dict(bucket["sentiment"])),
            "top_cities": [name for name, _ in bucket["cities"].most_common(3)],
        } for code, bucket in mentions.items() if code in PROVINCE_BY_CODE),
        key=lambda row: (-row["posts"], -row["engagement"], row["name"]),
    )

    return {
        "coverage": {
            "posts": total,
            "province": coverage["province"],
            "country_only": coverage["country"],
            "foreign": coverage["foreign"],
            "unknown": coverage["unknown"],
            "located_share": round(coverage["province"] / total, 4) if total else 0,
            "authors": len({str(post.get("author_username") or "").lower() for post in posts}),
            "authors_located": len(authors_by_kind["province"]),
            "threads": len(threads),
            "posts_with_thread": coverage["posts_with_thread"],
            "sources": dict(sources),
        },
        "trend_window": {
            "latest": latest.isoformat() if latest else None,
            "recent_hours": 24,
            "enabled": spans_days,
            "recent_posts": recent_total,
        },
        "provinces": province_rows,
        "cities": city_rows,
        "foreign": [{"country": country, "posts": count} for country, count in foreign.most_common()],
        "mentions": mention_rows,
    }

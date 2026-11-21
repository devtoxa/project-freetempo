import pyqrcode
url = "https://devtoxa.github.io/project-freetempo/"
qr = pyqrcode.create(url)
qr.png("link_qr.png", scale=8)
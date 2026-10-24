# Bring the loopback interface up without iproute2 (`ip` is not installed in this sandbox).
import fcntl, socket, struct

SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
req = struct.pack("16sh", b"lo", 0)
flags = struct.unpack("16sh", fcntl.ioctl(s, SIOCGIFFLAGS, req))[1]
fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sh", b"lo", flags | IFF_UP))

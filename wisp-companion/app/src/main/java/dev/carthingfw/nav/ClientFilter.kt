package dev.carthingfw.nav

import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface

/**
 * Who may read the phone's turns and location. By default only the Bluetooth
 * tether (the Car Thing), so nothing else on a shared Wi-Fi can; the testing
 * switch also lets in private LAN addresses for the PC simulator.
 */
object ClientFilter {
    /** one IPv4 network the phone is on */
    data class Net(val iface: String, val address: ByteArray, val prefix: Int)

    // Android names the Bluetooth PAN interface bt-pan on most phones, but not
    // all (bnep, btpan, a vendor name...), so rather than guess its name, rule
    // out the ones that are NOT a tether: Wi-Fi and its hotspot, mobile data,
    // VPNs and the system's own. Whatever is left is a local tether.
    private val NOT_TETHER = listOf(
        "wlan", "swlan", "ap", "p2p", "rmnet", "r_rmnet", "ccmni", "seth", "v4-", "clat",
        "tun", "ppp", "ipsec", "lo", "dummy", "ip6", "sit", "ifb", "aware", "nan",
    )

    fun isTether(iface: String) = NOT_TETHER.none { iface.startsWith(it) }

    fun allowed(remote: InetAddress, allowLan: Boolean, nets: List<Net> = phoneNets()): Boolean {
        if (remote !is Inet4Address) return false
        if (remote.isSiteLocalAddress && nets.any { isTether(it.iface) && inNet(remote.address, it) }) return true
        return allowLan && remote.isSiteLocalAddress
    }

    fun inNet(addr: ByteArray, net: Net): Boolean {
        if (addr.size != 4 || net.address.size != 4) return false
        var bits = net.prefix
        for (i in 0 until 4) {
            val mask = when {
                bits >= 8 -> 0xff
                bits <= 0 -> 0
                else -> (0xff shl (8 - bits)) and 0xff
            }
            if ((addr[i].toInt() and mask) != (net.address[i].toInt() and mask)) return false
            bits -= 8
        }
        return true
    }

    fun phoneNets(): List<Net> = try {
        NetworkInterface.getNetworkInterfaces().toList().flatMap { ni ->
            ni.interfaceAddresses
                .filter { it.address is Inet4Address }
                .map { Net(ni.name, it.address.address, it.networkPrefixLength.toInt()) }
        }
    } catch (e: Exception) {
        emptyList()
    }

    /** which of the phone's interfaces an address arrived on */
    fun ifaceFor(remote: InetAddress, nets: List<Net> = phoneNets()): String? =
        nets.firstOrNull { inNet(remote.address, it) }?.iface

    /** the phone's own Wi-Fi address, for pointing the PC simulator at it */
    fun lanAddress(): String? = phoneNets()
        .firstOrNull { it.iface.startsWith("wlan") }
        ?.let { InetAddress.getByAddress(it.address).hostAddress }
}
